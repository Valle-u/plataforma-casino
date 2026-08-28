/**
 * GregmornGameProvider — adapter que cumple IGameProvider para el launch.
 *
 * Seamless: la apuesta ocurre dentro del iframe de Gregmorn y vuelve por
 * callback (Fase 5). Acá solo se construye la launchUrl.
 *
 * Decisiones del launch:
 *   - `player_login` = NUESTRO `users.username`. Es lo que después llega en el
 *     campo `login` de los tres callbacks, así que es la clave con la que el
 *     callback resuelve al jugador. Mismo criterio que Forever (`userCode`).
 *   - `gameId` = el id CRUDO que guardó el sync en `games.config.gregmorn.gameId`
 *     (`integration:provider:game`), no el `games.code` sanitizado.
 *   - `callbackUrl` explícito en cada request, en vez de depender de la config
 *     por moneda del panel de ellos.
 *
 * El settle y los rollbacks NO pasan por acá — los reconcilia el callback.
 */

import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { users } from '@casino/db';
import type { TenantDb } from '../../../tenant-resolver/tenant-context';
import { TenantSettingsService } from '../../../tenant-settings/tenant-settings.service';
import { GregmornClient } from './gregmorn-client';
import { GregmornConfigError } from './gregmorn.errors';
import { GREGMORN_CODE, GREGMORN_DEFAULT_LANGUAGE } from './gregmorn.types';
import type {
  IGameProvider,
  LaunchParams,
  LaunchResult,
} from '../game-provider.interface';

interface GregmornGameConfig {
  gregmorn?: { gameId?: string; provider?: string | null };
}

@Injectable()
export class GregmornGameProvider implements IGameProvider {
  readonly code = GREGMORN_CODE;
  private readonly logger = new Logger(GregmornGameProvider.name);

  constructor(
    private readonly client: GregmornClient,
    private readonly settings: TenantSettingsService,
  ) {}

  async launchGame(params: LaunchParams, db?: unknown): Promise<LaunchResult> {
    if (!db) throw new Error('GregmornGameProvider requiere db para launchGame');
    const tenantDb = db as TenantDb;

    const userRows = await tenantDb
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(eq(users.id, params.userId))
      .limit(1);
    const user = userRows[0];
    if (!user) throw new Error(`Usuario ${params.userId} no encontrado`);

    const cfg = (params.game.config ?? {}) as GregmornGameConfig;
    const gameId = cfg.gregmorn?.gameId;
    if (!gameId) {
      throw new Error(
        `Juego ${params.game.code} no tiene config.gregmorn.gameId. Corré el sync del catálogo primero.`,
      );
    }

    const get = (key: string) =>
      this.settings.get<string>(tenantDb, `game_provider.gregmorn.${key}`);

    // URL a la que Gregmorn manda los callbacks de wallet de ESTA sesión. Se
    // manda explícita para no depender de su panel (que se configura por
    // moneda). Sin esto, un juego real no puede leer ni mover el saldo.
    const callbackUrl = (await get('callback_url'))?.trim();
    if (!callbackUrl) {
      throw new GregmornConfigError(
        'Falta game_provider.gregmorn.callback_url — sin eso los callbacks de wallet no llegan.',
      );
    }

    // A dónde vuelve el jugador al cerrar el juego. Obligatorio en su API.
    const exitUrl = (await get('exit_url'))?.trim();
    if (!exitUrl) {
      throw new GregmornConfigError('Falta game_provider.gregmorn.exit_url.');
    }

    const language = (await get('language'))?.trim() || GREGMORN_DEFAULT_LANGUAGE;

    const res = await this.client.openGame(tenantDb, {
      gameId,
      // El `login` con el que van a llegar los callbacks.
      playerLogin: user.username,
      exitUrl,
      callbackUrl,
      language,
      // Juego real. El modo demo (`demo: '1'`) no dispara callbacks y se usa
      // solo para validar auth/firma/launch en Stage (Fase 7); el lifecycle de
      // sesión de la plataforma no lo expone.
      demo: false,
    });

    this.logger.log(
      `Gregmorn launch: user=${user.username} game=${gameId} session=${res.providerSessionId || '?'}`,
    );

    return {
      // El sessionId de ellos: es el `sessionid` que traen los callbacks.
      providerSessionId: res.providerSessionId,
      launchUrl: res.launchUrl,
    };
  }
}
