/**
 * PalaceClient — cliente HTTP de la Main API de Palace Casino.
 *
 * Todos los métodos leen los settings del tenant (palace.api_url,
 * palace.api_token) y hacen POST a los endpoints de la v4.
 *
 * Concurrencia: máx 10 simultáneas por spec del proveedor. El pool
 * de fetch nativo de Node maneja esto automáticamente.
 *
 * Optimización: cada método público llama getSettings() una sola vez
 * y pasa el resultado a post() para evitar DB queries duplicadas.
 */

import { Injectable } from '@nestjs/common';
import { TenantSettingsService } from '../../../tenant-settings/tenant-settings.service';
import type { TenantDb } from '../../../tenant-resolver/tenant-context';

export interface PalaceAgentInfo {
  name: string;
  currency: string;
  balance: string;
  rtp: number;
  state: string;
}

export interface PalaceGameItem {
  game_code: string;
  game_name: string;
  locale_name: string;
  game_image: string | null;
  game_image_narrow: string | null;
  launch_enable: boolean;
  category: string;
  reg_date: string | null;
  provider_id: number;
}

export interface PalaceProviderItem {
  provider_id: number;
  /** Nombre oficial del estudio (Palace lo devuelve como `provider_name`, NO
   *  `provider` — ese error de campo hacía que los nombres quedaran vacíos). */
  provider_name: string;
  locale_name: string;
  /** 1=Normal, 2=Maintenance. */
  status: number;
}

export interface PalaceGameUrlResult {
  game_url: string;
}

export interface PalaceUserCreateResult {
  user_code: number;
  is_new_user: boolean;
}

interface PalaceEnvelope<T> {
  code: number;
  message: string | null;
  data: T;
}

interface PalaceSettings {
  apiUrl: string;
  apiToken: string;
  lang: number;
}

@Injectable()
export class PalaceClient {
  constructor(
    private readonly settings: TenantSettingsService,
  ) {}

  private async getSettings(db: TenantDb): Promise<PalaceSettings> {
    const apiUrl = (await this.settings.get<string>(db, 'palace.api_url')) ?? 'https://agent.goldslotpalase.com';
    const apiToken = (await this.settings.get<string>(db, 'palace.api_token')) ?? '';
    const lang = await this.settings.getNumeric(db, 'palace.default_lang', 4);
    if (!apiToken) throw new Error('palace.api_token no configurado para este tenant');
    return { apiUrl, apiToken, lang };
  }

  private async post<T>(
    db: TenantDb,
    path: string,
    body: Record<string, unknown>,
    opts?: { settings?: PalaceSettings; timeoutMs?: number },
  ): Promise<T> {
    const s = opts?.settings ?? await this.getSettings(db);
    const url = `${s.apiUrl}${path}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 10_000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${s.apiToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Palace API ${response.status}: ${await response.text()}`);
      }

      const envelope = (await response.json()) as PalaceEnvelope<T>;
      if (envelope.code !== 0) {
        throw new Error(`Palace API error code ${envelope.code}: ${envelope.message}`);
      }

      return envelope.data;
    } finally {
      clearTimeout(timer);
    }
  }

  async agentInfo(db: TenantDb): Promise<PalaceAgentInfo> {
    const s = await this.getSettings(db);
    return this.post<PalaceAgentInfo>(db, '/v4/agent/info', {}, { settings: s });
  }

  async userCreate(
    db: TenantDb,
    name: string,
  ): Promise<PalaceUserCreateResult> {
    const s = await this.getSettings(db);
    return this.post<PalaceUserCreateResult>(db, '/v4/user/create', { name }, { settings: s });
  }

  async gameProviders(db: TenantDb): Promise<PalaceProviderItem[]> {
    const s = await this.getSettings(db);
    const data = await this.post<unknown>(
      db,
      '/v4/game/providers',
      { lang: s.lang },
      // Metadata de catálogo (no camino de plata): timeout holgado.
      { settings: s, timeoutMs: 30_000 },
    );
    // La forma real de Palace es el ARRAY DIRECTO de `_Provider`
    // ({provider_id, provider_name, locale_name, status}); toleramos también el
    // envoltorio { list } (PagedList del swagger) por si cambia.
    const list = Array.isArray(data)
      ? data
      : ((data as { list?: PalaceProviderItem[] } | null)?.list ?? []);
    return list as PalaceProviderItem[];
  }

  async allGames(db: TenantDb): Promise<PalaceGameItem[]> {
    const s = await this.getSettings(db);
    const data = await this.post<PalaceGameItem[]>(
      db,
      '/v4/game/all',
      { lang: s.lang },
      // El catálogo completo (~2000+ juegos) no entra en 10s. 60s de margen.
      // Es una llamada de sincronización (no el callback de fichas).
      { settings: s, timeoutMs: 60_000 },
    );
    return data ?? [];
  }

  async gameUrl(
    db: TenantDb,
    params: {
      userCode: number;
      providerId: number;
      gameSymbol: string;
      lang?: number;
      rtp?: number;
      returnUrl?: string;
    },
  ): Promise<PalaceGameUrlResult> {
    const s = await this.getSettings(db);
    return this.post<PalaceGameUrlResult>(db, '/v4/game/game-url', {
      user_code: params.userCode,
      provider_id: params.providerId,
      game_symbol: params.gameSymbol,
      lang: params.lang ?? s.lang,
      ...(params.rtp ? { rtp: params.rtp } : {}),
      ...(params.returnUrl ? { return_url: params.returnUrl } : {}),
    }, { settings: s });
  }
}