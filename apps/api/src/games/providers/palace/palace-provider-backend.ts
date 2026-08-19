/**
 * PalaceProviderBackend — implementación de `IProviderBackend` para Palace.
 *
 * Encapsula todo lo que antes estaba hardcodeado en `GameProvidersService`:
 *   - lectura de settings `palace.*` (api_url / api_token / default_lang),
 *   - healthcheck vía `PalaceClient.agentInfo`,
 *   - sync de catálogo vía `PalaceSyncService.syncGames`,
 *   - chequeos de diagnose propios de Palace (callback token + callbacks 24h).
 *
 * Palace queda como el primer backend registrado en `ProviderBackendRegistry`;
 * su comportamiento es idéntico al previo (F0, sin cambios funcionales).
 */

import { Injectable } from '@nestjs/common';
import { and, eq, gte, sql } from 'drizzle-orm';
import { palaceTransactions } from '@casino/db';
import type { TenantDb } from '../../../tenant-resolver/tenant-context';
import { TenantSettingsService } from '../../../tenant-settings/tenant-settings.service';
import type {
  IProviderBackend,
  ProviderConfigView,
  ProviderDiagnoseCheck,
} from '../provider-backend.interface';
import { PalaceClient } from './palace-client';
import { PalaceSyncService } from './palace-sync.service';

@Injectable()
export class PalaceProviderBackend implements IProviderBackend {
  readonly code = 'palace';
  readonly displayName = 'Palace Casino';

  constructor(
    private readonly settings: TenantSettingsService,
    private readonly client: PalaceClient,
    private readonly sync: PalaceSyncService,
  ) {}

  async readConfigView(db: TenantDb): Promise<ProviderConfigView> {
    const apiUrl = (await this.settings.get<string>(db, 'palace.api_url')) ?? null;
    const apiToken =
      (await this.settings.get<string>(db, 'palace.api_token')) ?? null;
    const defaultLang =
      (await this.settings.get<number>(db, 'palace.default_lang')) ?? null;
    return {
      apiUrl,
      defaultLang,
      apiTokenSet: !!apiToken && apiToken.length > 0,
    };
  }

  async testConnection(db: TenantDb): Promise<void> {
    // Lanza si falla — el caller (GameProvidersService) mide latencia y persiste.
    await this.client.agentInfo(db);
  }

  async syncGames(db: TenantDb): Promise<Record<string, unknown>> {
    // Spread a objeto literal: PalaceSyncResult (interface nombrada) no es
    // asignable directo a Record<string, unknown> sin index signature.
    return { ...(await this.sync.syncGames(db)) };
  }

  async diagnoseExtra(db: TenantDb): Promise<ProviderDiagnoseCheck[]> {
    const checks: ProviderDiagnoseCheck[] = [];

    // Callback token (env var del server).
    const callbackToken = process.env.PALACE_CALLBACK_TOKEN;
    checks.push({
      key: 'callback_token',
      label: 'Callback token del server configurado',
      ok: !!callbackToken && callbackToken.length > 0,
      detail: callbackToken
        ? 'PALACE_CALLBACK_TOKEN seteado.'
        : 'Falta la env var PALACE_CALLBACK_TOKEN (los callbacks se rechazan).',
    });

    // Callbacks recibidos en las últimas 24h.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(palaceTransactions)
      .where(
        and(
          eq(palaceTransactions.status, 'OK'),
          gte(palaceTransactions.createdAt, since),
        ),
      );
    const recentCount = recent[0]?.total ?? 0;
    checks.push({
      key: 'recent_callbacks',
      label: 'Actividad de callbacks (24h)',
      ok: true, // informativo, no falla
      detail: `${recentCount} callbacks OK en las últimas 24h.`,
    });

    return checks;
  }
}
