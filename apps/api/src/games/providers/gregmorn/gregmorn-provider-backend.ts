/**
 * GregmornProviderBackend — implementación de `IProviderBackend` para Gregmorn.
 *
 * Gemelo de `PalaceProviderBackend` y `ForeverProviderBackend`: le da al
 * `GameProvidersService` una forma uniforme de leer config, testear conexión,
 * sincronizar catálogo y diagnosticar, sin que el service sepa nada específico
 * del proveedor.
 *
 * Registrarlo en `ProviderBackendRegistry` es lo que hace aparecer a Gregmorn en
 * el panel: `GameProvidersService.ensureRow` crea la fila de `game_providers` a
 * partir del `displayName` de acá.
 */

import { Injectable } from '@nestjs/common';
import { TenantSettingsService } from '../../../tenant-settings/tenant-settings.service';
import type { TenantDb } from '../../../tenant-resolver/tenant-context';
import type {
  IProviderBackend,
  ProviderConfigView,
  ProviderDiagnoseCheck,
} from '../provider-backend.interface';
import { GregmornClient } from './gregmorn-client';
import { GregmornSyncService } from './gregmorn-sync.service';
import { GREGMORN_CODE } from './gregmorn.types';

@Injectable()
export class GregmornProviderBackend implements IProviderBackend {
  readonly code = GREGMORN_CODE;
  readonly displayName = 'Gregmorn Hub';

  constructor(
    private readonly settings: TenantSettingsService,
    private readonly client: GregmornClient,
    private readonly sync: GregmornSyncService,
  ) {}

  async readConfigView(db: TenantDb): Promise<ProviderConfigView> {
    // De los dos hosts, el "principal" para la vista es el de office (auth +
    // catálogo). El de client se ve en el diagnóstico.
    const apiUrl =
      (await this.settings.get<string>(db, 'game_provider.gregmorn.api_url_office')) ??
      null;
    const secret = await this.settings.get<string>(
      db,
      'game_provider.gregmorn.secret_api_key',
    );
    return {
      apiUrl,
      // El idioma de Gregmorn es un ISO corto por request, no un int como Palace.
      defaultLang: null,
      // La credencial mínima para operar es la secret key (firma las dos vías).
      apiTokenSet: !!secret && secret.length > 0,
    };
  }

  /**
   * Healthcheck. Gregmorn no tiene un endpoint liviano tipo `GetAgentInfo`, así
   * que se usa `/auth/login`: si responde, el host, el login y el password son
   * correctos. Lanza si falla — el caller mide latencia y persiste el ping.
   */
  async testConnection(db: TenantDb): Promise<void> {
    await this.client.login(db);
  }

  async syncGames(db: TenantDb): Promise<Record<string, unknown>> {
    return { ...(await this.sync.syncGames(db)) };
  }

  async diagnoseExtra(db: TenantDb): Promise<ProviderDiagnoseCheck[]> {
    const get = (key: string) =>
      this.settings.get<string>(db, `game_provider.gregmorn.${key}`);

    const apiUrlClient = await get('api_url_client');
    const login = await get('login');
    const password = await get('password');
    const secret = await get('secret_api_key');
    const callbackUrl = await get('callback_url');
    const exitUrl = await get('exit_url');

    return [
      {
        key: 'api_url_client',
        label: 'Host de launch (client API)',
        ok: !!apiUrlClient,
        detail: apiUrlClient
          ? `openGame apunta a ${apiUrlClient}`
          : 'Falta api_url_client — no se puede abrir ningún juego.',
      },
      {
        key: 'credentials',
        label: 'Usuario y contraseña de la API',
        ok: !!login && !!password,
        detail:
          login && password
            ? `Login: ${login}`
            : 'Faltan login y/o password — no se puede pedir el catálogo.',
      },
      {
        key: 'secret_api_key',
        label: 'Secret API key (firma HMAC)',
        ok: !!secret,
        detail: secret
          ? 'Cargada. Firma el openGame y verifica los callbacks entrantes.'
          : 'Falta la secret key — no se firma el launch ni se validan los callbacks.',
      },
      {
        key: 'callback_url',
        label: 'Callback URL de wallet',
        ok: !!callbackUrl,
        detail: callbackUrl
          ? callbackUrl
          : 'Falta. Sin esto los juegos reales no pueden leer ni mover el saldo. Usá "Activar callbacks".',
      },
      {
        key: 'exit_url',
        label: 'URL de salida del juego',
        ok: !!exitUrl,
        detail: exitUrl ? exitUrl : 'Falta exit_url — su API la exige en cada openGame.',
      },
    ];
  }
}
