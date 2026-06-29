/**
 * BettingCapsService — topes de apuesta por exposición (Blindaje núcleo, Parte B,
 * B-build-4b). Ver docs/16-tesoreria.md §10.
 *
 * Limita el VOLUMEN apostado (turnover) por período (mensual) en dos niveles:
 *   - por jugador (que ninguno solo dispare la exposición), y
 *   - global del tenant (techo total del mes).
 *
 * Protege contra el escenario del provider externo: un bug/fraude que dispare el
 * volumen apostado genera GGR real en el proveedor → factura real. El tope se
 * chequea ANTES de aceptar la apuesta y BLOQUEA si la superaría.
 *
 * Config en `tenant_settings` (0 / ausente = sin tope). Turnover = Σ de
 * `game_rounds.bet_amount` del mes en curso (UTC).
 */

import { Injectable } from '@nestjs/common';
import { and, eq, gte, sql } from 'drizzle-orm';
import { gameRounds } from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { TenantSettingsService } from '../tenant-settings/tenant-settings.service';
import { BettingCapExceededError } from './betting-caps.errors';

const KEY_PLAYER = 'betting.cap_player_monthly';
const KEY_GLOBAL = 'betting.cap_global_monthly';

export interface BettingCaps {
  /** Tope mensual de turnover por jugador. 0 = sin tope. */
  playerMonthly: number;
  /** Tope mensual de turnover global del tenant. 0 = sin tope. */
  globalMonthly: number;
}

export interface BettingCapsStatus {
  caps: BettingCaps;
  turnover: { player: string; global: string };
  /** Inicio del período (1° del mes UTC) en ISO. */
  periodStart: string;
}

@Injectable()
export class BettingCapsService {
  constructor(private readonly settings: TenantSettingsService) {}

  /** Inicio del mes en curso (UTC). */
  private periodStart(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }

  async getCaps(db: TenantDb): Promise<BettingCaps> {
    return {
      playerMonthly: await this.settings.getNumeric(db, KEY_PLAYER, 0),
      globalMonthly: await this.settings.getNumeric(db, KEY_GLOBAL, 0),
    };
  }

  async setCaps(
    db: TenantDb,
    caps: { playerMonthly: number; globalMonthly: number },
    actorUserId: string,
  ): Promise<void> {
    await this.settings.set(db, KEY_PLAYER, caps.playerMonthly, actorUserId);
    await this.settings.set(db, KEY_GLOBAL, caps.globalMonthly, actorUserId);
  }

  /** Σ de bet_amount desde `from` (opcionalmente filtrado por jugador). */
  private async turnover(
    db: TenantDb,
    from: Date,
    userId?: string,
  ): Promise<string> {
    const where = userId
      ? and(gte(gameRounds.placedAt, from), eq(gameRounds.userId, userId))
      : gte(gameRounds.placedAt, from);
    const rows = await db
      .select({
        sum: sql<string>`COALESCE(SUM(${gameRounds.betAmount}), 0)::text`,
      })
      .from(gameRounds)
      .where(where);
    return rows[0]?.sum ?? '0';
  }

  /** Estado de topes + turnover del período (para el panel). */
  async getStatus(db: TenantDb, userId?: string): Promise<BettingCapsStatus> {
    const from = this.periodStart();
    const caps = await this.getCaps(db);
    const global = await this.turnover(db, from);
    const player = userId ? await this.turnover(db, from, userId) : '0';
    return {
      caps,
      turnover: { player, global },
      periodStart: from.toISOString(),
    };
  }

  /**
   * BLOQUEA (tira `BettingCapExceededError`) si la apuesta superaría algún tope
   * mensual. Llamado en game-rounds ANTES de aceptar la apuesta. No-op si no
   * hay topes configurados.
   */
  async assertWithinCaps(
    db: TenantDb,
    userId: string,
    betAmount: string,
  ): Promise<void> {
    const caps = await this.getCaps(db);
    if (caps.playerMonthly <= 0 && caps.globalMonthly <= 0) return;

    const from = this.periodStart();
    const bet = Number(betAmount);

    if (caps.playerMonthly > 0) {
      const current = Number(await this.turnover(db, from, userId));
      if (current + bet > caps.playerMonthly) {
        throw new BettingCapExceededError('player', caps.playerMonthly, current);
      }
    }
    if (caps.globalMonthly > 0) {
      const current = Number(await this.turnover(db, from));
      if (current + bet > caps.globalMonthly) {
        throw new BettingCapExceededError('global', caps.globalMonthly, current);
      }
    }
  }
}
