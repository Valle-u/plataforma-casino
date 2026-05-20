/**
 * BonusesCashbackService — cálculo periódico de cashback sobre netwin.
 *
 * Flow conceptual:
 *   1. Bucket de período cerrado más reciente según `def.config.periodDays`.
 *   2. Para cada `bonus_definitions WHERE type='cashback' AND status='active'`:
 *      a. Listar users con actividad bet/win en la ventana del bucket.
 *      b. Para cada user: netwin = SUM(win) - SUM(bet). Si netwin < 0
 *         (perdió), calcular cashback = min(|netwin| * pct/100, maxCashback).
 *      c. Si |netwin| < minNetloss → skip (anti-spam de micro-cashbacks).
 *      d. Otorgar via UserBonusesService.grantManual con idempotency key
 *         `cashback:<defId>:<userId>:<bucketIndex>` — un user solo recibe
 *         el cashback UNA vez por bucket cerrado.
 *
 * Buckets fijos (no overlapping rolling window):
 *   - bucketIndex = floor(daysSinceEpoch / periodDays).
 *   - El job procesa el ÚLTIMO bucket cerrado (bucketIndex - 1).
 *   - Si el job corre todos los días pero periodDays=7, solo otorga
 *     cashback los lunes (cuando se cierra el bucket de la semana
 *     anterior). Los demás días: mismo bucket cerrado → mismo key →
 *     no-op idempotente.
 *
 * Sin engine de juegos hoy las tx bet/win son sintéticas (creadas en
 * tests). Cuando llegue Fase 6 (game-providers), el flow real las
 * generará y el cashback empezará a funcionar automáticamente sin
 * cambios acá.
 */

import { Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, gte, lt, sql } from 'drizzle-orm';
import {
  bonusDefinitions,
  wallets,
  walletTransactions,
  type BonusDefinition,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { UserBonusesService } from './user-bonuses.service';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface CashbackConfig {
  pct?: number;
  periodDays?: number;
  minNetloss?: number | string;
  maxCashback?: number | string;
}

export interface CashbackRunResult {
  /** Definitions de cashback procesadas. */
  definitionsProcessed: number;
  /** Total de user_bonuses grants efectivamente creados. */
  grantsCreated: number;
  /** Grants saltados porque ya existían (idempotency). */
  grantsSkippedIdempotent: number;
  /** Users evaluados que no calificaron (netwin positivo o |netwin| < minNetloss). */
  usersSkippedNoNetloss: number;
  /** Errores por user — sigue procesando los demás. */
  failed: number;
  failedIds: string[];
  /** Detalle por definition para diagnóstico. */
  byDefinition: Array<{
    definitionId: string;
    code: string;
    bucketIndex: number;
    periodStart: string;
    periodEnd: string;
    grantsCreated: number;
    grantsSkippedIdempotent: number;
    usersSkippedNoNetloss: number;
  }>;
}

@Injectable()
export class BonusesCashbackService {
  private readonly logger = new Logger(BonusesCashbackService.name);

  constructor(private readonly userBonusesService: UserBonusesService) {}

  /**
   * Procesa cashback para el tenant provisto. `asOf` permite anclar el
   * "ahora" para tests determinísticos. Default = `new Date()`.
   */
  async runForTenant(db: TenantDb, asOf: Date = new Date()): Promise<CashbackRunResult> {
    const result: CashbackRunResult = {
      definitionsProcessed: 0,
      grantsCreated: 0,
      grantsSkippedIdempotent: 0,
      usersSkippedNoNetloss: 0,
      failed: 0,
      failedIds: [],
      byDefinition: [],
    };

    const defs = await db
      .select()
      .from(bonusDefinitions)
      .where(
        and(
          eq(bonusDefinitions.type, 'cashback'),
          eq(bonusDefinitions.status, 'active'),
        ),
      )
      .orderBy(asc(bonusDefinitions.code));

    for (const def of defs) {
      try {
        const perDef = await this.processDefinition(db, def, asOf);
        result.definitionsProcessed += 1;
        result.grantsCreated += perDef.grantsCreated;
        result.grantsSkippedIdempotent += perDef.grantsSkippedIdempotent;
        result.usersSkippedNoNetloss += perDef.usersSkippedNoNetloss;
        result.byDefinition.push(perDef);
      } catch (err) {
        this.logger.error(
          `Cashback definition ${def.id} (${def.code}) falló: ${(err as Error).message}`,
        );
      }
    }

    return result;
  }

  private async processDefinition(
    db: TenantDb,
    def: BonusDefinition,
    asOf: Date,
  ): Promise<CashbackRunResult['byDefinition'][number]> {
    const config = (def.config ?? {}) as CashbackConfig;
    const periodDays = Math.max(1, Math.floor(Number(config.periodDays ?? 7)));
    const pct = Number(config.pct ?? 0);
    const minNetlossCents = this.toCents(this.numericAsString(config.minNetloss ?? 0));
    const maxCashbackCents = config.maxCashback === undefined || config.maxCashback === null
      ? null
      : this.toCents(this.numericAsString(config.maxCashback));

    // Bucket cerrado más reciente.
    const daysSinceEpoch = Math.floor(asOf.getTime() / MS_PER_DAY);
    const currentBucket = Math.floor(daysSinceEpoch / periodDays);
    const closedBucket = currentBucket - 1;
    const periodStartMs = closedBucket * periodDays * MS_PER_DAY;
    const periodEndMs = periodStartMs + periodDays * MS_PER_DAY;
    const periodStart = new Date(periodStartMs);
    const periodEnd = new Date(periodEndMs);

    const perDef = {
      definitionId: def.id,
      code: def.code,
      bucketIndex: closedBucket,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      grantsCreated: 0,
      grantsSkippedIdempotent: 0,
      usersSkippedNoNetloss: 0,
    };

    if (pct <= 0) {
      this.logger.debug(
        `Cashback def ${def.code} con pct=${pct} → skip (config inválida).`,
      );
      return perDef;
    }

    // Listar netwin por user en la ventana. SUM por type, agrupado.
    const rows = await db
      .select({
        userId: wallets.userId,
        bets: sql<string>`coalesce(sum(case when ${walletTransactions.type} = 'bet' then ${walletTransactions.amount} else 0 end), 0)::text`,
        wins: sql<string>`coalesce(sum(case when ${walletTransactions.type} = 'win' then ${walletTransactions.amount} else 0 end), 0)::text`,
      })
      .from(walletTransactions)
      .innerJoin(wallets, eq(wallets.id, walletTransactions.walletId))
      .where(
        and(
          gte(walletTransactions.createdAt, periodStart),
          lt(walletTransactions.createdAt, periodEnd),
          sql`${walletTransactions.type} IN ('bet', 'win')`,
        ),
      )
      .groupBy(wallets.userId);

    for (const row of rows) {
      const betsCents = this.toCents(row.bets);
      const winsCents = this.toCents(row.wins);
      const netwinCents = winsCents - betsCents;

      if (netwinCents >= 0) {
        // El jugador no perdió; no aplica cashback.
        perDef.usersSkippedNoNetloss += 1;
        continue;
      }

      const netlossCents = -netwinCents;
      if (netlossCents < minNetlossCents) {
        perDef.usersSkippedNoNetloss += 1;
        continue;
      }

      let cashbackCents = Math.floor((netlossCents * pct) / 100);
      if (maxCashbackCents !== null && cashbackCents > maxCashbackCents) {
        cashbackCents = maxCashbackCents;
      }
      if (cashbackCents <= 0) {
        perDef.usersSkippedNoNetloss += 1;
        continue;
      }

      const cashbackAmount = this.fromCents(cashbackCents);
      const grantKey = `cashback:${def.id}:${row.userId}:${closedBucket}`;

      try {
        // grantManual es idempotente — si la key ya existe con mismos
        // params, devuelve el existing. Lo aprovechamos para detectar
        // "ya otorgado" vs "recién creado" mirando granted_at.
        const before = await this.userBonusesService.findByGrantKey(db, grantKey);
        const { bonus: granted } = await this.userBonusesService.grantManual(db, {
          actorUserId: def.fundedByUserId,
          userId: row.userId,
          definitionId: def.id,
          amount: cashbackAmount,
          reason: `Cashback automático ${def.code} bucket ${closedBucket} netloss ${this.fromCents(netlossCents)}`,
          grantIdempotencyKey: grantKey,
          sourceEvent: {
            kind: 'cashback',
            definitionId: def.id,
            bucketIndex: closedBucket,
            periodStart: periodStart.toISOString(),
            periodEnd: periodEnd.toISOString(),
            netlossAmount: this.fromCents(netlossCents),
            cashbackAmount,
          },
          // Sprint 51.2: cashback cron es system action. El "actor"
          // (def.fundedByUserId) acá es el funder de la definition,
          // pero el rol-check podría rebotar para definitions legacy
          // sin owner claro. Skipeamos — el target/owner check sigue.
          skipActorRoleCheck: true,
        });
        if (before) {
          // Ya existía — idempotency hit, no se duplicó.
          perDef.grantsSkippedIdempotent += 1;
        } else {
          perDef.grantsCreated += 1;
          this.logger.log(
            `Cashback granted: user=${row.userId} def=${def.code} amount=${cashbackAmount} bucket=${closedBucket} bonus=${granted.id}`,
          );
        }
      } catch (err) {
        this.logger.error(
          `Cashback grant falló para user=${row.userId} def=${def.code}: ${(err as Error).message}`,
        );
        // Propagamos el conteo de fallos al nivel del run.
        throw err;
      }
    }

    return perDef;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Helpers (ídem a otros services del módulo bonuses)
  // ──────────────────────────────────────────────────────────────────────

  private toCents(amount: string): number {
    const [int, dec = ''] = amount.split('.');
    const decPadded = (dec + '00').slice(0, 2);
    return Number(int) * 100 + Number(decPadded);
  }

  private fromCents(cents: number): string {
    const sign = cents < 0 ? '-' : '';
    const abs = Math.abs(cents);
    const int = Math.floor(abs / 100);
    const dec = (abs % 100).toString().padStart(2, '0');
    return `${sign}${int}.${dec}`;
  }

  private numericAsString(v: number | string): string {
    return typeof v === 'number' ? v.toString() : v;
  }
}
