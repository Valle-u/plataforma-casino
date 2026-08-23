/**
 * Unit test de ForeverGameProvider.launchGame — verifica que arma el GetGameUrl
 * con userCode = username y el vendorCode/gameCode de config.forever, sin pegarle
 * a la API real (ForeverClient mockeado).
 */

import { ForeverGameProvider } from './forever-game-provider';
import { ForeverClient } from './forever-client';
import { TenantSettingsService } from '../../../tenant-settings/tenant-settings.service';
import type { LaunchParams } from '../game-provider.interface';
import type { Game } from '@casino/db';

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
  return { code: 'forever_v_g', config } as unknown as Game;
}

describe('ForeverGameProvider.launchGame', () => {
  const user = { id: 'user-1', username: 'jugador1' };

  function make(getGameUrl: jest.Mock, currency?: string) {
    const client = { getGameUrl } as unknown as ForeverClient;
    // settings.get devuelve la moneda configurada (undefined → default ARS).
    const settings = {
      get: jest.fn().mockResolvedValue(currency),
    } as unknown as TenantSettingsService;
    return new ForeverGameProvider(client, settings);
  }

  it('llama GetGameUrl con userCode=username + vendor/game de config.forever', async () => {
    const getGameUrl = jest.fn().mockResolvedValue({ launchUrl: 'https://forever/game?sid=abc' });
    const provider = make(getGameUrl);
    const params: LaunchParams = {
      game: gameWith({ forever: { vendorCode: 'pragmatic', gameCode: 'vs20', gameType: 1 } }),
      userId: 'user-1',
      currency: 'CHIPS',
    };

    const res = await provider.launchGame(params, mockDb(user));

    expect(getGameUrl).toHaveBeenCalledTimes(1);
    const [, arg] = getGameUrl.mock.calls[0];
    expect(arg).toMatchObject({
      userCode: 'jugador1',
      vendorCode: 'pragmatic',
      gameCode: 'vs20',
      // Sin setting de moneda → default ARS (la cuenta de Forever opera en ARS).
      currencyCode: 'ARS',
    });
    expect(res).toEqual({ providerSessionId: 'jugador1', launchUrl: 'https://forever/game?sid=abc' });
  });

  it('usa la moneda del setting game_provider.forever.currency si está seteada', async () => {
    const getGameUrl = jest.fn().mockResolvedValue({ launchUrl: 'https://forever/game?sid=abc' });
    const provider = make(getGameUrl, 'USD');
    const params: LaunchParams = {
      game: gameWith({ forever: { vendorCode: 'pragmatic', gameCode: 'vs20', gameType: 1 } }),
      userId: 'user-1',
      currency: 'CHIPS',
    };

    await provider.launchGame(params, mockDb(user));

    const [, arg] = getGameUrl.mock.calls[0];
    expect(arg).toMatchObject({ currencyCode: 'USD' });
  });

  it('lanza si el juego no tiene config.forever.vendorCode', async () => {
    const provider = make(jest.fn());
    const params: LaunchParams = {
      game: gameWith({}),
      userId: 'user-1',
      currency: 'CHIPS',
    };
    await expect(provider.launchGame(params, mockDb(user))).rejects.toThrow(/vendorCode/);
  });

  it('lanza si el usuario no existe', async () => {
    const provider = make(jest.fn());
    const params: LaunchParams = {
      game: gameWith({ forever: { vendorCode: 'x' } }),
      userId: 'ghost',
      currency: 'CHIPS',
    };
    await expect(provider.launchGame(params, mockDb(null))).rejects.toThrow(/no encontrado/);
  });

  it('lanza si no hay db', async () => {
    const provider = make(jest.fn());
    const params: LaunchParams = {
      game: gameWith({ forever: { vendorCode: 'x' } }),
      userId: 'user-1',
      currency: 'CHIPS',
    };
    await expect(provider.launchGame(params)).rejects.toThrow(/requiere db/);
  });
});
