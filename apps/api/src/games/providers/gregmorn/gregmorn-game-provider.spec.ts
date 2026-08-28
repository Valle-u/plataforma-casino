/**
 * Unit test de GregmornGameProvider.launchGame — verifica que arma el openGame
 * con `player_login` = username y el `gameId` CRUDO de `config.gregmorn`, sin
 * pegarle a la API real (GregmornClient mockeado).
 *
 * Espeja `forever-game-provider.spec.ts`.
 */

import { GregmornGameProvider } from './gregmorn-game-provider';
import { GregmornClient } from './gregmorn-client';
import { TenantSettingsService } from '../../../tenant-settings/tenant-settings.service';
import type { LaunchParams } from '../game-provider.interface';
import type { Game } from '@casino/db';

const CALLBACK_URL = 'https://api.miamihub.vip/api/v1/game-provider/gregmorn/callback';
const EXIT_URL = 'https://miamihub.vip/juegos';
const RAW_GAME_ID = 'integration_a:provider_a:game_001';

/** Mock de db: select().from().where().limit() → [{id, username}]. */
function mockDb(userRow: { id: string; username: string } | null) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(userRow ? [userRow] : []),
        }),
      }),
    }),
  };
}

function gameWith(config: Record<string, unknown>): Game {
  return { code: 'gregmorn_integration-a-provider-a-game-001', config } as unknown as Game;
}

/** settings.get resuelve por key `game_provider.gregmorn.<x>`. */
function settingsWith(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    'game_provider.gregmorn.callback_url': CALLBACK_URL,
    'game_provider.gregmorn.exit_url': EXIT_URL,
    ...overrides,
  };
  return {
    get: jest.fn((_db: unknown, key: string) => Promise.resolve(values[key])),
  } as unknown as TenantSettingsService;
}

describe('GregmornGameProvider.launchGame', () => {
  const user = { id: 'user-1', username: 'jugador1' };

  function make(openGame: jest.Mock, settings = settingsWith()) {
    const client = { openGame } as unknown as GregmornClient;
    return new GregmornGameProvider(client, settings);
  }

  function paramsWith(config: Record<string, unknown>): LaunchParams {
    return { game: gameWith(config), userId: 'user-1', currency: 'CHIPS' };
  }

  const okConfig = { gregmorn: { gameId: RAW_GAME_ID, provider: 'PG Soft' } };

  function okOpenGame() {
    return jest.fn().mockResolvedValue({
      launchUrl: 'https://client-api-dev.gregmorn.org/game/x?session=sess-1',
      providerSessionId: 'sess-1',
    });
  }

  it('llama openGame con player_login=username y el gameId crudo', async () => {
    const openGame = okOpenGame();
    const provider = make(openGame);

    const res = await provider.launchGame(paramsWith(okConfig), mockDb(user));

    expect(openGame).toHaveBeenCalledTimes(1);
    const [, arg] = openGame.mock.calls[0];
    expect(arg).toMatchObject({
      playerLogin: 'jugador1',
      // El id CRUDO con los `:`, no el games.code sanitizado.
      gameId: RAW_GAME_ID,
      exitUrl: EXIT_URL,
      // Sin setting de idioma → default 'es'.
      language: 'es',
      // Nunca demo: el demo no dispara callbacks de wallet.
      demo: false,
    });
    // Por default NO se manda callbackUrl: el proveedor lo ignora y pidió que
    // dejáramos de enviarlo (2026-08-28).
    expect(arg).not.toHaveProperty('callbackUrl');
    expect(res).toEqual({
      providerSessionId: 'sess-1',
      launchUrl: 'https://client-api-dev.gregmorn.org/game/x?session=sess-1',
    });
  });

  it('usa el idioma del setting si está seteado', async () => {
    const openGame = okOpenGame();
    const provider = make(
      openGame,
      settingsWith({ 'game_provider.gregmorn.language': 'pt' }),
    );

    await provider.launchGame(paramsWith(okConfig), mockDb(user));

    const [, arg] = openGame.mock.calls[0];
    expect(arg).toMatchObject({ language: 'pt' });
  });

  it('lanza si el juego no tiene config.gregmorn.gameId', async () => {
    const provider = make(jest.fn());
    await expect(provider.launchGame(paramsWith({}), mockDb(user))).rejects.toThrow(
      /gameId/,
    );
  });

  it('con send_callback_url activo SÍ manda la callbackUrl', async () => {
    const openGame = okOpenGame();
    const provider = make(
      openGame,
      settingsWith({ 'game_provider.gregmorn.send_callback_url': true }),
    );

    await provider.launchGame(paramsWith(okConfig), mockDb(user));

    const [, arg] = openGame.mock.calls[0];
    expect(arg).toMatchObject({ callbackUrl: CALLBACK_URL });
  });

  it('send_callback_url activo pero sin callback_url cargada → lanza', async () => {
    const openGame = okOpenGame();
    const provider = make(
      openGame,
      settingsWith({
        'game_provider.gregmorn.send_callback_url': true,
        'game_provider.gregmorn.callback_url': undefined,
      }),
    );
    await expect(
      provider.launchGame(paramsWith(okConfig), mockDb(user)),
    ).rejects.toThrow(/callback_url/);
    expect(openGame).not.toHaveBeenCalled();
  });

  it('sin callback_url cargada y con el envío apagado → abre igual', async () => {
    // La wallet no queda muda: los callbacks llegan por la URL del panel de
    // ellos, no por la que mandamos nosotros.
    const openGame = okOpenGame();
    const provider = make(
      openGame,
      settingsWith({ 'game_provider.gregmorn.callback_url': undefined }),
    );
    await expect(
      provider.launchGame(paramsWith(okConfig), mockDb(user)),
    ).resolves.toMatchObject({ providerSessionId: 'sess-1' });
  });

  it('lanza si falta el exit_url (obligatorio en su API)', async () => {
    const openGame = okOpenGame();
    const provider = make(
      openGame,
      settingsWith({ 'game_provider.gregmorn.exit_url': undefined }),
    );
    await expect(
      provider.launchGame(paramsWith(okConfig), mockDb(user)),
    ).rejects.toThrow(/exit_url/);
    expect(openGame).not.toHaveBeenCalled();
  });

  it('lanza si el usuario no existe', async () => {
    const provider = make(jest.fn());
    await expect(provider.launchGame(paramsWith(okConfig), mockDb(null))).rejects.toThrow(
      /no encontrado/,
    );
  });

  it('lanza si no hay db', async () => {
    const provider = make(jest.fn());
    await expect(provider.launchGame(paramsWith(okConfig))).rejects.toThrow(/requiere db/);
  });
});
