/**
 * PalaceGameProvider — adapter que cumple IGameProvider.
 *
 * A diferencia del Mock (que es síncrono), Palace maneja las apuestas
 * dentro de su propio iframe y nos notifica via callbacks.
 *
 *   - launchGame: llama a Main API user/create + game/game-url.
 *   - settleRound: NO se usa (Palace settlea via callback).
 *   - rollback: NO se usa (Palace maneja sus rollbacks via cancel callback).
 */

import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { users } from '@casino/db';
import type { TenantDb } from '../../../tenant-resolver/tenant-context';
import { PalaceClient } from './palace-client';
import type {
  IGameProvider,
  LaunchParams,
  LaunchResult,
  RollbackParams,
  SettleParams,
  SettleResult,
} from '../game-provider.interface';

@Injectable()
export class PalaceGameProvider implements IGameProvider {
  readonly code = 'palace';
  private readonly logger = new Logger(PalaceGameProvider.name);

  constructor(
    private readonly client: PalaceClient,
  ) {}

  async launchGame(params: LaunchParams, db?: unknown): Promise<LaunchResult> {
    if (!db) throw new Error('PalaceGameProvider requiere db para launchGame');
    const tenantDb = db as TenantDb;
    // 1. Generar account si el user no lo tiene
    const userRows = await tenantDb
      .select()
      .from(users)
      .where(eq(users.id, params.userId))
      .limit(1);

    const user = userRows[0];
    if (!user) throw new Error(`Usuario ${params.userId} no encontrado`);

    let account = user.palaceAccount;
    let userCode = user.palaceUserCode;

    if (!account) {
      // Generar account desde el user.id: 'u' + últimos 11 chars del UUID
      const suffix = params.userId.replace(/-/g, '').slice(-11);
      account = `u${suffix}`;

      // Guardar palace_account ANTES de llamar a user/create porque Palace
      // dispara un callback authenticate que busca el user por palace_account.
      // Si no lo encuentra → CALLBACK_ERROR (1015).
      await tenantDb
        .update(users)
        .set({ palaceAccount: account })
        .where(eq(users.id, params.userId));

      const createResult = await this.client.userCreate(tenantDb, account);
      userCode = createResult.user_code;

      await tenantDb
        .update(users)
        .set({ palaceUserCode: userCode })
        .where(eq(users.id, params.userId));

      this.logger.log(`Usuario Palace creado: account=${account}, user_code=${userCode}`);
    }

    // 2. Si ya tiene account pero no user_code, re-obtener
    if (!userCode && account) {
      const createResult = await this.client.userCreate(tenantDb, account);
      userCode = createResult.user_code;
      await tenantDb
        .update(users)
        .set({ palaceUserCode: userCode })
        .where(eq(users.id, params.userId));
    }

    // 3. Llamar game/game-url
    const game = params.game;
    if (!game.palaceProviderId || !game.palaceGameSymbol) {
      throw new Error(
        `Juego ${game.code} no tiene palace_provider_id o palace_game_symbol. ` +
        `Corre el sync del catálogo primero.`,
      );
    }

    const urlResult = await this.client.gameUrl(tenantDb, {
      userCode: userCode!,
      providerId: game.palaceProviderId,
      gameSymbol: game.palaceGameSymbol,
    });

    return {
      providerSessionId: account,
      launchUrl: urlResult.game_url,
    };
  }

  /**
   * NO se usa para Palace — el provider settlea via callback.
   * PalaceCallbackService maneja bet/win/cancel llega del proveedor.
   */
  async settleRound(_params: SettleParams): Promise<SettleResult> {
    throw new Error(
      'PalaceGameProvider.settleRound no está soportado — Palace settlea via callback',
    );
  }

  async rollback(_params: RollbackParams): Promise<void> {
    // Palace maneja sus propios rollbacks via cancel callback.
    return Promise.resolve();
  }
}