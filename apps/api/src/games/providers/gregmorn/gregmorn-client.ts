/**
 * GregmornClient — cliente HTTP de la API de Gregmorn Hub.
 *
 * Ver docs/gregmorn/01-api-spec.md. Tres particularidades frente a Forever:
 *
 *   1. **Dos hosts.** `office` (auth + catálogo) y `client` (abrir juego). Se
 *      configuran por separado porque Stage y Prod difieren en ambos.
 *   2. **Auth mixta.** `/auth/login` es `application/x-www-form-urlencoded`
 *      (mandar JSON da 400/401 — ellos lo marcan como error común), el catálogo
 *      va con Bearer, y `openGame` NO usa Bearer: se autentica con la firma
 *      HMAC `X-Signature`.
 *   3. **El `accessToken` tiene TTL corto y no hay endpoint de refresh** pese a
 *      que devuelven `refreshToken`. Se cachea en memoria hasta poco antes de su
 *      `exp` y se re-loguea al vencer.
 *
 * El cacheo es por credencial (host + login), no global: cada tenant tiene las
 * suyas en `tenant_settings` y no se pisan entre sí.
 */

import { Injectable } from '@nestjs/common';
import { TenantSettingsService } from '../../../tenant-settings/tenant-settings.service';
import type { TenantDb } from '../../../tenant-resolver/tenant-context';
import { signGregmornRequest } from './gregmorn-signer';
import { GregmornApiError, GregmornConfigError } from './gregmorn.errors';
import {
  GREGMORN_DEFAULT_CURRENCY,
  type GregmornDemoFlag,
  type GregmornGameCatalogItem,
  type GregmornGameUrlResult,
  type GregmornLoginResponse,
  type GregmornOpenGameRequest,
  type GregmornOpenGameResponse,
} from './gregmorn.types';

/** Credenciales + config del tenant, ya validadas. */
export interface GregmornSettings {
  apiUrlOffice: string;
  apiUrlClient: string;
  login: string;
  password: string;
  secretApiKey: string;
  userId: string;
  currency: string;
}

interface CachedToken {
  token: string;
  /** Epoch ms a partir del cual se considera vencido. */
  expiresAtMs: number;
}

/** Margen antes del `exp` real del JWT, para no usar un token al borde. */
const TOKEN_SKEW_MS = 30_000;

/** TTL de fallback si el `accessToken` no trae `exp` legible. */
const TOKEN_FALLBACK_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class GregmornClient {
  /** Cache de accessToken por `${apiUrlOffice}|${login}`. */
  private readonly tokenCache = new Map<string, CachedToken>();

  constructor(private readonly settings: TenantSettingsService) {}

  /**
   * Lee y valida las credenciales del tenant.
   *
   * Todas viven en `tenant_settings` bajo `game_provider.gregmorn.*` — nunca en
   * variables de entorno ni en el repo: son POR TENANT. Ver
   * docs/gregmorn/00-intake.md.
   */
  async getSettings(db: TenantDb): Promise<GregmornSettings> {
    const get = (key: string) =>
      this.settings.get<string>(db, `game_provider.gregmorn.${key}`);

    const apiUrlOffice = await get('api_url_office');
    const apiUrlClient = await get('api_url_client');
    const login = await get('login');
    const password = await get('password');
    const secretApiKey = await get('secret_api_key');
    const userId = await get('user_id');
    const currency = await get('currency');

    if (!apiUrlOffice) {
      throw new GregmornConfigError('Falta game_provider.gregmorn.api_url_office.');
    }
    if (!apiUrlClient) {
      throw new GregmornConfigError('Falta game_provider.gregmorn.api_url_client.');
    }
    if (!login) throw new GregmornConfigError('Falta game_provider.gregmorn.login.');
    if (!password) throw new GregmornConfigError('Falta game_provider.gregmorn.password.');
    if (!secretApiKey) {
      throw new GregmornConfigError('Falta game_provider.gregmorn.secret_api_key.');
    }
    if (!userId) {
      // Dato pendiente del proveedor al 2026-08-28 (docs/gregmorn/00-intake.md).
      // Es obligatorio tanto en openGame como en getUserGames.
      throw new GregmornConfigError(
        'Falta game_provider.gregmorn.user_id (obligatorio en openGame y getUserGames).',
      );
    }

    return {
      apiUrlOffice: stripTrailingSlash(apiUrlOffice),
      apiUrlClient: stripTrailingSlash(apiUrlClient),
      login,
      password,
      secretApiKey,
      userId,
      currency: currency?.trim() ? currency.trim() : GREGMORN_DEFAULT_CURRENCY,
    };
  }

  /**
   * `POST /auth/login` (office). Devuelve tokens + el usuario de API.
   *
   * **Form-urlencoded, no JSON.** Sin cache: es el que refresca el cache.
   */
  async login(
    db: TenantDb,
    opts?: { settings?: GregmornSettings; timeoutMs?: number },
  ): Promise<GregmornLoginResponse> {
    const s = opts?.settings ?? (await this.getSettings(db));

    const body = new URLSearchParams({ login: s.login, password: s.password });

    return this.request<GregmornLoginResponse>(
      `${s.apiUrlOffice}/auth/login`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: body.toString(),
      },
      opts?.timeoutMs ?? 10_000,
    );
  }

  /**
   * Catálogo: `GET /users/{user_id}/getUserGames/{currencyISO}` (office, Bearer).
   *
   * `currency` default: la del tenant. El `id` de cada item viene con forma
   * `integration:provider:game` y es lo que después se manda como `gameId`.
   */
  async getUserGames(
    db: TenantDb,
    opts?: { settings?: GregmornSettings; currency?: string; timeoutMs?: number },
  ): Promise<GregmornGameCatalogItem[]> {
    const s = opts?.settings ?? (await this.getSettings(db));
    const currency = opts?.currency?.trim() ? opts.currency.trim() : s.currency;
    const token = await this.getAccessToken(db, s);

    const url =
      `${s.apiUrlOffice}/users/${encodeURIComponent(s.userId)}` +
      `/getUserGames/${encodeURIComponent(currency)}`;

    const res = await this.request<GregmornGameCatalogItem[]>(
      url,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      },
      // El catálogo completo puede ser grande: timeout más holgado que el resto.
      opts?.timeoutMs ?? 30_000,
    );

    return Array.isArray(res) ? res : [];
  }

  /**
   * Launch: `POST /games/openGame` (client, firmado con `X-Signature`).
   *
   * NO usa Bearer. El body se serializa UNA sola vez: se firma y se manda ese
   * mismo string, porque la firma es sobre los bytes exactos (ver
   * `gregmorn-signer.ts`).
   *
   * Siempre mandamos `callbackUrl` explícito en vez de depender de la config por
   * moneda del panel de ellos — una cosa menos que se puede desincronizar.
   */
  async openGame(
    db: TenantDb,
    params: {
      gameId: string;
      playerLogin: string;
      exitUrl: string;
      callbackUrl: string;
      language: string;
      demo?: boolean;
      currency?: string;
      /** IP del jugador. Algunos estudios la exigen. */
      ip?: string;
      freespinTotalBet?: number;
      freespinCount?: number;
    },
    opts?: { settings?: GregmornSettings; timeoutMs?: number },
  ): Promise<GregmornGameUrlResult> {
    const s = opts?.settings ?? (await this.getSettings(db));
    const demo: GregmornDemoFlag = params.demo ? '1' : '0';

    const payload: GregmornOpenGameRequest = {
      currency: params.currency?.trim() ? params.currency.trim() : s.currency,
      demo,
      exitUrl: params.exitUrl,
      gameId: params.gameId,
      language: params.language,
      player_login: params.playerLogin,
      user_id: s.userId,
      callbackUrl: params.callbackUrl,
      ...(params.ip ? { ip: params.ip } : {}),
      ...(params.freespinTotalBet !== undefined
        ? { freespinTotalBet: params.freespinTotalBet }
        : {}),
      ...(params.freespinCount !== undefined
        ? { freespinCount: params.freespinCount }
        : {}),
    };

    // Una sola serialización: lo que se firma es lo que se manda.
    const bodyJson = JSON.stringify(payload);
    const sig = signGregmornRequest({ body: bodyJson, secretApiKey: s.secretApiKey });

    const res = await this.request<GregmornOpenGameResponse>(
      `${s.apiUrlClient}/games/openGame`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...sig.headers,
        },
        body: bodyJson,
      },
      opts?.timeoutMs ?? 15_000,
    );

    const launchUrl = res.content?.game?.url;
    const providerSessionId = res.content?.gameRes?.sessionId;
    if (!launchUrl) {
      throw new GregmornApiError(200, 'openGame no devolvió content.game.url.');
    }

    return { launchUrl, providerSessionId: providerSessionId ?? '' };
  }

  /**
   * `accessToken` vigente para el catálogo. Cacheado hasta poco antes de su
   * `exp`; al vencer se vuelve a loguear (no hay endpoint de refresh).
   */
  private async getAccessToken(db: TenantDb, s: GregmornSettings): Promise<string> {
    const key = tokenCacheKey(s);
    const cached = this.tokenCache.get(key);
    if (cached && cached.expiresAtMs > Date.now()) return cached.token;

    const res = await this.login(db, { settings: s });
    if (!res.accessToken) {
      throw new GregmornApiError(200, '/auth/login no devolvió accessToken.');
    }

    this.tokenCache.set(key, {
      token: res.accessToken,
      expiresAtMs: tokenExpiryMs(res.accessToken),
    });
    return res.accessToken;
  }

  /** Invalida el token cacheado del tenant (tras un 401, o al rotar credenciales). */
  invalidateToken(s: GregmornSettings): void {
    this.tokenCache.delete(tokenCacheKey(s));
  }

  /**
   * `fetch` con timeout + traducción del contrato de error de ellos
   * (`{ status: 'fail', error, code, message }`) a `GregmornApiError`.
   */
  private async request<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const text = await response.text();

      if (!response.ok) {
        throw toApiError(response.status, text);
      }

      let json: unknown;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        throw new GregmornApiError(
          response.status,
          `Gregmorn devolvió una respuesta no-JSON: ${truncate(text)}`,
        );
      }

      // Pueden mandar el envelope de error con HTTP 2xx.
      if (isFailEnvelope(json)) {
        throw failEnvelopeToError(response.status, json);
      }

      return json as T;
    } catch (err) {
      if (err instanceof GregmornApiError) throw err;
      if ((err as Error)?.name === 'AbortError') {
        throw new GregmornApiError(0, `Gregmorn timeout tras ${timeoutMs}ms: ${url}`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

function tokenCacheKey(s: GregmornSettings): string {
  return `${s.apiUrlOffice}|${s.login}`;
}

/** Arma el error tipado a partir de un HTTP no-2xx, usando su envelope si vino. */
function toApiError(httpStatus: number, text: string): GregmornApiError {
  try {
    const json: unknown = JSON.parse(text);
    if (isFailEnvelope(json)) return failEnvelopeToError(httpStatus, json);
  } catch {
    // Body no-JSON: cae al genérico de abajo.
  }
  return new GregmornApiError(httpStatus, `Gregmorn HTTP ${httpStatus}: ${truncate(text)}`);
}

interface GregmornFailEnvelope {
  status: string;
  error?: unknown;
  code?: unknown;
  message?: unknown;
}

function failEnvelopeToError(
  httpStatus: number,
  json: GregmornFailEnvelope,
): GregmornApiError {
  const detail =
    (typeof json.message === 'string' && json.message) ||
    (typeof json.error === 'string' && json.error) ||
    'sin detalle';
  return new GregmornApiError(
    httpStatus,
    `Gregmorn HTTP ${httpStatus} status fail: ${detail}`,
    typeof json.code === 'number' ? json.code : undefined,
    typeof json.error === 'string' ? json.error : undefined,
  );
}

function isFailEnvelope(value: unknown): value is GregmornFailEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { status?: unknown }).status === 'fail'
  );
}

/**
 * `exp` del JWT (con margen), o un TTL de fallback.
 *
 * El token es de ellos: solo se LEE el `exp` para saber cuándo re-loguear. No se
 * verifica ni se confía en su contenido para ninguna otra cosa.
 */
function tokenExpiryMs(accessToken: string): number {
  const fallback = Date.now() + TOKEN_FALLBACK_TTL_MS;
  const parts = accessToken.split('.');
  const payloadB64 = parts.length === 3 ? parts[1] : undefined;
  if (!payloadB64) return fallback;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
      exp?: unknown;
    };
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return fallback;
    const expMs = payload.exp * 1000 - TOKEN_SKEW_MS;
    return expMs > Date.now() ? expMs : Date.now();
  } catch {
    return fallback;
  }
}

function stripTrailingSlash(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function truncate(text: string, max = 300): string {
  const clean = (text ?? '').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}
