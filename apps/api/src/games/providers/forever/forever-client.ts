/**
 * ForeverClient — cliente HTTP de la Main API (Operator API) de Forever.
 *
 * Diferencias con Palace:
 *   - UN solo endpoint (`api_url`): el `method` va en el body, no en el path.
 *   - Envelope PLANO: `{ status, msg, ...data }` (status 0 = OK), no `{code,message,data}`.
 *   - Auth = `token` + `agentCode` en el body + firma Ed25519 en headers
 *     `X-Forever-Sig-*` sobre el body crudo (ver forever-signer.ts).
 *
 * Ver docs/forever/01-api-spec.md + 02-signing.md.
 */

import { Injectable } from '@nestjs/common';
import { TenantSettingsService } from '../../../tenant-settings/tenant-settings.service';
import type { TenantDb } from '../../../tenant-resolver/tenant-context';
import { signForeverRequest } from './forever-signer';
import { ForeverApiError, ForeverConfigError } from './forever.errors';
import {
  FOREVER_STATUS,
  type ForeverChannel,
  type ForeverGameUrlResult,
  type ForeverResponseBase,
  type ForeverVendor,
  type ForeverVendorGame,
} from './forever.types';

interface ForeverSettings {
  apiUrl: string;
  agentCode: string;
  apiToken: string;
  privateKeyBase64: string;
}

@Injectable()
export class ForeverClient {
  constructor(private readonly settings: TenantSettingsService) {}

  /** Lee (y valida presencia de) las credenciales del tenant para Forever. */
  private async getSettings(db: TenantDb): Promise<ForeverSettings> {
    const apiUrl = await this.settings.get<string>(db, 'game_provider.forever.api_url');
    const agentCode = await this.settings.get<string>(db, 'game_provider.forever.agent_code');
    const apiToken = await this.settings.get<string>(db, 'game_provider.forever.api_token');
    const privateKeyBase64 = await this.settings.get<string>(
      db,
      'game_provider.forever.request_sign_private_key',
    );
    if (!apiUrl) throw new ForeverConfigError('Falta game_provider.forever.api_url.');
    if (!agentCode) throw new ForeverConfigError('Falta game_provider.forever.agent_code.');
    if (!apiToken) throw new ForeverConfigError('Falta game_provider.forever.api_token.');
    if (!privateKeyBase64) {
      throw new ForeverConfigError('Falta game_provider.forever.request_sign_private_key.');
    }
    return { apiUrl, agentCode, apiToken, privateKeyBase64 };
  }

  /**
   * POST firmado a la Main API. `method` es el nombre de la operación; `params`
   * son los campos extra del body (además de method/token/agentCode).
   */
  private async post<T extends ForeverResponseBase>(
    db: TenantDb,
    method: string,
    params: Record<string, unknown>,
    opts?: { settings?: ForeverSettings; timeoutMs?: number },
  ): Promise<T> {
    const s = opts?.settings ?? (await this.getSettings(db));

    // El body FIRMADO debe ser el MISMO string que se envía (el hash es sobre
    // esos bytes exactos). Por eso se serializa una sola vez.
    const bodyJson = JSON.stringify({
      method,
      token: s.apiToken,
      agentCode: s.agentCode,
      ...params,
    });

    const sig = signForeverRequest({
      agentCode: s.agentCode,
      privateKeyBase64: s.privateKeyBase64,
      body: bodyJson,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 10_000);
    try {
      const response = await fetch(s.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...sig.headers,
        },
        body: bodyJson,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new ForeverApiError(
          response.status,
          `Forever API HTTP ${response.status}: ${await response.text()}`,
        );
      }

      const json = (await response.json()) as T;
      if (json.status !== FOREVER_STATUS.SUCCESS) {
        throw new ForeverApiError(
          json.status,
          `Forever API status ${json.status}: ${json.msg ?? 'sin detalle'}`,
        );
      }
      return json;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * GetAgentInfo — healthcheck liviano (rate limit 3s). Sirve para el
   * testConnection del panel: si responde status 0, la config + firma andan.
   */
  async agentInfo(db: TenantDb): Promise<ForeverResponseBase & Record<string, unknown>> {
    return this.post(db, 'GetAgentInfo', {});
  }

  /**
   * GetVendors — lista de proveedores del catálogo (rate limit 1s).
   * NOTA: el nombre del campo de la lista en la respuesta no está confirmado en
   * el spec (pág. no capturada); se prueba `vendors`/`list` contra la API real.
   */
  async getVendors(db: TenantDb): Promise<ForeverVendor[]> {
    const res = await this.post<
      ForeverResponseBase & { vendors?: ForeverVendor[]; list?: ForeverVendor[] }
    >(db, 'GetVendors', {}, { timeoutMs: 30_000 });
    return res.vendors ?? res.list ?? [];
  }

  /**
   * GetVendorGames — juegos de un vendor (rate limit 1s). `vendorCode` de GetVendors.
   * El campo de la lista es `vendorGames` (confirmado contra la API real / spec pág. 23).
   * OJO: `gameName` e `imageUrl` vienen como JSON de locales (ej. {"en":"..."}); el
   * sync los parsea (ver forever-sync.service).
   */
  async getVendorGames(db: TenantDb, vendorCode: string): Promise<ForeverVendorGame[]> {
    const res = await this.post<
      ForeverResponseBase & {
        vendorGames?: ForeverVendorGame[];
        games?: ForeverVendorGame[];
        list?: ForeverVendorGame[];
      }
    >(db, 'GetVendorGames', { vendorCode }, { timeoutMs: 30_000 });
    return res.vendorGames ?? res.games ?? res.list ?? [];
  }

  /**
   * GetGameUrl — abre un juego y devuelve la launchUrl (rate limit 6s/usuario,
   * 10/min). `userCode` es NUESTRO id de jugador (site user code).
   */
  async getGameUrl(
    db: TenantDb,
    params: {
      userCode: string;
      vendorCode: string;
      gameCode?: string;
      currencyCode: string;
      channel?: ForeverChannel;
      language?: string;
      nickname?: string;
      homeUrl?: string;
      lowRtp?: number;
      highRtp?: number;
      isDemo?: boolean;
    },
  ): Promise<ForeverGameUrlResult> {
    const res = await this.post<ForeverResponseBase & { launchUrl: string }>(
      db,
      'GetGameUrl',
      {
        userCode: params.userCode,
        vendorCode: params.vendorCode,
        currencyCode: params.currencyCode,
        ...(params.gameCode ? { gameCode: params.gameCode } : {}),
        ...(params.channel ? { channel: params.channel } : {}),
        ...(params.language ? { language: params.language } : {}),
        ...(params.nickname ? { nickname: params.nickname } : {}),
        ...(params.homeUrl ? { homeUrl: params.homeUrl } : {}),
        ...(params.lowRtp !== undefined ? { lowRtp: params.lowRtp } : {}),
        ...(params.highRtp !== undefined ? { highRtp: params.highRtp } : {}),
        ...(params.isDemo !== undefined ? { isDemo: params.isDemo } : {}),
      },
      { timeoutMs: 15_000 },
    );
    return { launchUrl: res.launchUrl };
  }
}
