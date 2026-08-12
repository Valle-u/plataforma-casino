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
      // Generar account desde el user.id: 'u' + últimos 11 chars del UUID + random suffix
      // El suffix random evita colisiones si un intento previo creó el usuario en Palace
      // pero falló al guardar el user_code en nuestra DB.
      const suffix = params.userId.replace(/-/g, '').slice(-11);
      const rand = Math.random().toString(36).slice(2, 6);
      account = `u${suffix}${rand}`;

      // Guardar palace_account ANTES de llamar a user/create porque Palace
      // dispara un callback authenticate que busca el user por palace_account.
      // Si no lo encuentra → CALLBACK_ERROR (1015).
      await tenantDb
        .update(users)
        .set({ palaceAccount: account })
        .where(eq(users.id, params.userId));

      try {
        const createResult = await this.client.userCreate(tenantDb, account);
        userCode = createResult.user_code;

        await tenantDb
          .update(users)
          .set({ palaceUserCode: userCode })
          .where(eq(users.id, params.userId));

        this.logger.log(`Usuario Palace creado: account=${account}, user_code=${userCode}`);
      } catch (err) {
        // Si userCreate falla (timeout, CALLBACK_ERROR, UNKNOWN_ERROR, etc.),
        // limpiar palace_account para que el siguiente intento genere uno nuevo.
        // Palace puede haber creado el usuario con este account — no importa,
        // el nuevo intento generará un account distinto (random suffix).
        this.logger.error(
          `Palace userCreate falló para account=${account}: ${(err as Error).message}`,
        );
        await tenantDb
          .update(users)
          .set({ palaceAccount: null })
          .where(eq(users.id, params.userId));
        throw err;
      }
    }

    // 2. Si ya tiene account pero no user_code, re-obtener con el mismo account
    if (!userCode && account) {
      try {
        const createResult = await this.client.userCreate(tenantDb, account);
        userCode = createResult.user_code;
        await tenantDb
          .update(users)
          .set({ palaceUserCode: userCode })
          .where(eq(users.id, params.userId));
      } catch (err) {
        // Si falla de nuevo, limpiar todo para que el siguiente intente desde cero
        this.logger.error(
          `Palace userCreate retry falló para account=${account}: ${(err as Error).message}`,
        );
        await tenantDb
          .update(users)
          .set({ palaceAccount: null })
          .where(eq(users.id, params.userId));
        throw err;
      }
    }

    // 3. Llamar game/game-url
    const game = params.game;
    if (!game.palaceProviderId || !game.palaceGameSymbol) {
      throw new Error(
        `Juego ${game.code} no tiene palace_provider_id o palace_game_symbol. ` +
        `Corre el sync del catálogo primero.`,
      );
    }

    const providerId = game.palaceProviderId;
    const gameSymbol = game.palaceGameSymbol;

    let urlResult;
    try {
      urlResult = await this.client.gameUrl(tenantDb, {
        userCode: userCode!,
        providerId,
        gameSymbol,
      });
    } catch (err) {
      // Auto-recuperación: si el user_code guardado ya no existe en Palace
      // (USER_NOT_FOUND 2002 — reset del entorno de Palace, usuario viejo de
      // otro agente, o código de seed inválido), regeneramos el usuario UNA vez
      // (nuevo palace_account + user/create) y reintentamos. En seamless el
      // balance vive en NUESTRA wallet, así que recrear la identidad en Palace
      // no pierde fichas.
      if (err instanceof Error && err.message.includes('USER_NOT_FOUND')) {
        this.logger.warn(
          `Palace user_code ${userCode} obsoleto para ${params.userId}; regenerando usuario y reintentando.`,
        );
        const suffix = params.userId.replace(/-/g, '').slice(-11);
        const rand = Math.random().toString(36).slice(2, 6);
        account = `u${suffix}${rand}`;
        // Guardar el nuevo account (y limpiar el code viejo) ANTES de user/create:
        // Palace dispara el callback authenticate que busca por palace_account.
        await tenantDb
          .update(users)
          .set({ palaceAccount: account, palaceUserCode: null })
          .where(eq(users.id, params.userId));
        const created = await this.client.userCreate(tenantDb, account);
        userCode = created.user_code;
        await tenantDb
          .update(users)
          .set({ palaceUserCode: userCode })
          .where(eq(users.id, params.userId));
        this.logger.log(
          `Usuario Palace regenerado: account=${account}, user_code=${userCode}`,
        );
        urlResult = await this.client.gameUrl(tenantDb, {
          userCode: userCode!,
          providerId,
          gameSymbol,
        });
      } else {
        throw err;
      }
    }

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