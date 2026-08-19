/**
 * ForeverProviderBackend — implementación de `IProviderBackend` para Forever.
 *
 * Es el gemelo de PalaceProviderBackend: le da al `GameProvidersService` una
 * forma uniforme de leer config, testear conexión, sincronizar catálogo y
 * diagnosticar Forever, sin que el service sepa nada específico del proveedor.
 */

import { Injectable } from '@nestjs/common';
import { TenantSettingsService } from '../../../tenant-settings/tenant-settings.service';
import type { TenantDb } from '../../../tenant-resolver/tenant-context';
import type {
  IProviderBackend,
  ProviderConfigView,
  ProviderDiagnoseCheck,
} from '../provider-backend.interface';
import { ForeverClient } from './forever-client';
import { ForeverSyncService } from './forever-sync.service';

@Injectable()
export class ForeverProviderBackend implements IProviderBackend {
  readonly code = 'forever';
  readonly displayName = 'Forever';

  constructor(
    private readonly settings: TenantSettingsService,
    private readonly client: ForeverClient,
    private readonly sync: ForeverSyncService,
  ) {}

  async readConfigView(db: TenantDb): Promise<ProviderConfigView> {
    const apiUrl =
      (await this.settings.get<string>(db, 'game_provider.forever.api_url')) ?? null;
    const apiToken =
      (await this.settings.get<string>(db, 'game_provider.forever.api_token')) ?? null;
    return {
      apiUrl,
      // Forever no usa "default_lang" como Palace; el idioma va por request.
      defaultLang: null,
      apiTokenSet: !!apiToken && apiToken.length > 0,
    };
  }

  async testConnection(db: TenantDb): Promise<void> {
    // Lanza si falla — el caller mide latencia y persiste el ping.
    await this.client.agentInfo(db);
  }

  async syncGames(db: TenantDb): Promise<Record<string, unknown>> {
    return { ...(await this.sync.syncGames(db)) };
  }

  async diagnoseExtra(db: TenantDb): Promise<ProviderDiagnoseCheck[]> {
    const agentCode = await this.settings.get<string>(db, 'game_provider.forever.agent_code');
    const privKey = await this.settings.get<string>(
      db,
      'game_provider.forever.request_sign_private_key',
    );
    const pubKey = await this.settings.get<string>(
      db,
      'game_provider.forever.callback_verify_public_key',
    );

    return [
      {
        key: 'agent_code',
        label: 'Código de agente configurado',
        ok: !!agentCode && agentCode.length > 0,
        detail: agentCode
          ? `Agent code: ${agentCode}`
          : 'Falta game_provider.forever.agent_code.',
      },
      {
        key: 'sign_private_key',
        label: 'Clave privada de firma (Ed25519) cargada',
        ok: !!privKey && privKey.length > 0,
        detail: privKey
          ? 'Clave privada presente (firma de requests salientes).'
          : 'Falta la clave privada de firma — los requests a Forever fallarán.',
      },
      {
        key: 'callback_public_key',
        label: 'Clave pública de verificación de callbacks',
        ok: !!pubKey && pubKey.length > 0,
        detail: pubKey
          ? 'Clave pública presente (verificación de callbacks entrantes).'
          : 'Falta la clave pública — no se podrán verificar los callbacks.',
      },
    ];
  }
}
