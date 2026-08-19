/**
 * ForeverGameProvider — adapter que cumple IGameProvider para el launch.
 *
 * Seamless: la apuesta se maneja dentro del iframe de Forever y nos llega por
 * callback (F2). Acá solo construimos la launchUrl.
 *   - launchGame: GetGameUrl con userCode = NUESTRO username (el callback
 *     resuelve el jugador por `WHERE username = userCode`) + el vendorCode /
 *     gameCode que el sync guardó en `games.config.forever`.
 *
 * El settle y los rollbacks NO pasan por acá: Forever es seamless y los
 * reconcilia ForeverCallbackService (ChangeBalance del proveedor).
 */

import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { users } from '@casino/db';
import type { TenantDb } from '../../../tenant-resolver/tenant-context';
import { ForeverClient } from './forever-client';
import type {
  IGameProvider,
  LaunchParams,
  LaunchResult,
} from '../game-provider.interface';

interface ForeverGameConfig {
  forever?: { vendorCode?: string; gameCode?: string; gameType?: number };
}

@Injectable()
export class ForeverGameProvider implements IGameProvider {
  readonly code = 'forever';
  private readonly logger = new Logger(ForeverGameProvider.name);

  constructor(private readonly client: ForeverClient) {}

  async launchGame(params: LaunchParams, db?: unknown): Promise<LaunchResult> {
    if (!db) throw new Error('ForeverGameProvider requiere db para launchGame');
    const tenantDb = db as TenantDb;

    const userRows = await tenantDb
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(eq(users.id, params.userId))
      .limit(1);
    const user = userRows[0];
    if (!user) throw new Error(`Usuario ${params.userId} no encontrado`);

    const cfg = (params.game.config ?? {}) as ForeverGameConfig;
    const vendorCode = cfg.forever?.vendorCode;
    const gameCode = cfg.forever?.gameCode;
    if (!vendorCode) {
      throw new Error(
        `Juego ${params.game.code} no tiene config.forever.vendorCode. Corré el sync del catálogo primero.`,
      );
    }

    const res = await this.client.getGameUrl(tenantDb, {
      // userCode = nuestro username: así el callback (F2) resuelve el jugador.
      userCode: user.username,
      vendorCode,
      gameCode,
      // La cuenta de Forever opera en USD (ver docs/forever/01-api-spec §0).
      currencyCode: 'USD',
      channel: 'desktop',
    });

    this.logger.log(`Forever launch: user=${user.username} vendor=${vendorCode} game=${gameCode ?? '?'}`);
    return {
      providerSessionId: user.username,
      launchUrl: res.launchUrl,
    };
  }
}
