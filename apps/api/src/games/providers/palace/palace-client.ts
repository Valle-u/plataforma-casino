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
  provider: string;
  provider_logo: string | null;
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
    const data = await this.post<{ list: PalaceProviderItem[] }>(
      db,
      '/v4/game/providers',
      { lang: s.lang },
      { settings: s },
    );
    return data.list ?? [];
  }

  async allGames(db: TenantDb): Promise<PalaceGameItem[]> {
    const s = await this.getSettings(db);
    const data = await this.post<PalaceGameItem[]>(
      db,
      '/v4/game/all',
      { lang: s.lang },
      { settings: s },
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