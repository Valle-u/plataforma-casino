/**
 * API client — wrapper fino sobre fetch que:
 *   - Setea el header `Host` correcto del tenant (en dev, via custom header).
 *   - Inyecta el token JWT desde localStorage si está logueado.
 *   - Maneja respuestas no-2xx tirando un `ApiError` tipado.
 *   - Auto-pasea por rewrite de Next.js (/api/* → backend).
 *
 * El backend NestJS resuelve el tenant por `Host` header (TenantResolver
 * middleware). En dev, el web corre en :3001 y el backend en :3000. El
 * rewrite de next.config.ts envía /api/* al backend. Pero el `Host`
 * llega como `localhost:3001` que NO matchea ningún tenant. Solución:
 * setear `X-Tenant-Host` con el slug correcto + ajustar el backend para
 * leerlo como override en dev (pendiente). Mientras tanto: en dev se
 * usa `jest.localhost` directo y el TenantResolver lo encuentra si el
 * Host del fetch trae ese valor — algunos browsers no permiten setear
 * Host. Workaround: forwardar a través del rewrite + agregar header
 * `X-Forwarded-Host` que el backend honra como override.
 */

const API_BASE = '/api'; // proxy via next.config.ts rewrites

/**
 * Detecta el panel activo según la ruta actual.
 *   - `/play/*` → 'player'
 *   - todo lo demás → 'admin'
 *
 * Esto permite sesiones aisladas en el mismo dominio:
 * admin y player usan keys de localStorage distintas.
 */
export function getPanel(): 'admin' | 'player' {
  if (typeof window === 'undefined') return 'player';
  return window.location.pathname.startsWith('/play') ? 'player' : 'admin';
}

/**
 * Keys de storage por panel. El impersonate cruza paneles (admin → /play),
 * así que la escritura/lectura de tokens necesita saber a qué panel apunta.
 */
function storageKeysFor(panel: 'admin' | 'player') {
  return {
    token: panel === 'admin' ? 'casino_admin_token' : 'casino_player_token',
    refreshToken:
      panel === 'admin' ? 'casino_admin_refresh_token' : 'casino_player_refresh_token',
    tenantHost:
      panel === 'admin' ? 'casino_admin_tenant_host' : 'casino_player_tenant_host',
  };
}

/** Default del tenant host en dev — lo lee de env o cae al demo tenant. */
const DEFAULT_TENANT_HOST =
  process.env.NEXT_PUBLIC_TENANT_HOST ?? 'demo.localhost';

/**
 * Error tipado que tira `api()` cuando el backend responde !2xx.
 * Sprint 54 lint cleanup: pasamos de interface a clase que extiende `Error`
 * para cumplir `@typescript-eslint/only-throw-error`. El shape público
 * (status/message/code/details) es idéntico, así que los call sites que
 * hacen `isApiError(err)` siguen funcionando sin cambios.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  /** Payload original del backend (issues, validation errors, etc.) */
  readonly details?: unknown;

  constructor(init: {
    status: number;
    message: string;
    code?: string;
    details?: unknown;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
  }
}

export function isApiError(err: unknown): err is ApiError {
  // No usamos `instanceof ApiError` porque después de un bundle split / HMR
  // pueden existir 2 referencias a la clase. Duck-typing por la prop
  // `status` numérica es estable.
  return (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    typeof err.status === 'number'
  );
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  /** Body que se va a JSON.stringify. */
  json?: unknown;
  /** Header de idempotency-key para mutaciones. */
  idempotencyKey?: string;
  /** Skip auth header (e.g. para login mismo). */
  skipAuth?: boolean;
  /** Timeout del request en ms (default 30s). Subilo para operaciones largas
   *  como el sync del catálogo (~30s). */
  timeoutMs?: number;
}

export function getTokenForPanel(panel: 'admin' | 'player'): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(storageKeysFor(panel).token);
}

export function setTokenForPanel(
  panel: 'admin' | 'player',
  token: string | null,
): void {
  if (typeof window === 'undefined') return;
  const key = storageKeysFor(panel).token;
  if (token) window.localStorage.setItem(key, token);
  else window.localStorage.removeItem(key);
}

export function getRefreshTokenForPanel(panel: 'admin' | 'player'): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(storageKeysFor(panel).refreshToken);
}

export function setRefreshTokenForPanel(
  panel: 'admin' | 'player',
  token: string | null,
): void {
  if (typeof window === 'undefined') return;
  const key = storageKeysFor(panel).refreshToken;
  if (token) window.localStorage.setItem(key, token);
  else window.localStorage.removeItem(key);
}

export function clearAuthTokensForPanel(panel: 'admin' | 'player'): void {
  if (typeof window === 'undefined') return;
  const keys = storageKeysFor(panel);
  window.localStorage.removeItem(keys.token);
  window.localStorage.removeItem(keys.refreshToken);
}

/**
 * Helpers del panel actual. Resuelven el panel en CADA llamada (no en
 * import time): así una navegación client-side entre /dashboard y /play
 * lee/escribe las keys correctas sin recargar la página.
 */
export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return getTokenForPanel(getPanel());
}

export function setToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  setTokenForPanel(getPanel(), token);
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return getRefreshTokenForPanel(getPanel());
}

export function setRefreshToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  setRefreshTokenForPanel(getPanel(), token);
}

export function clearAuthTokens(): void {
  if (typeof window === 'undefined') return;
  clearAuthTokensForPanel(getPanel());
}

interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
}

/** Promise global para evitar múltiples refresh simultáneos. */
let refreshPromise: Promise<string | null> | null = null;

/**
 * Refresca el access token usando el refresh token.
 * Devuelve el nuevo access token, o null si no se pudo refrescar.
 */
export async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  refreshPromise = (async (): Promise<string | null> => {
    try {
      const res = await fetch(`${API_BASE}/tenant/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-Host': getTenantHost(),
        },
        body: JSON.stringify({ refreshToken }),
      });

      if (!res.ok) return null;

      const data = (await res.json().catch(() => null)) as RefreshResponse | null;
      if (!data?.accessToken || !data?.refreshToken) return null;

      setToken(data.accessToken);
      setRefreshToken(data.refreshToken);
      return data.accessToken;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export function getTenantHost(): string {
  if (typeof window === 'undefined') return DEFAULT_TENANT_HOST;
  // El env var del build manda. Si el operador quiere override manual
  // (e.g. apuntar a otro tenant temporalmente sin re-build), puede setear
  // `casino_admin_tenant_host_override` en localStorage. Sin esa key,
  // siempre usamos el default del env. Esto evita el bug de un dev
  // que quedó con un host stale en localStorage de pruebas viejas.
  const override = window.localStorage.getItem(
    storageKeysFor(getPanel()).tenantHost + '_override',
  );
  return override ?? DEFAULT_TENANT_HOST;
}

export function setTenantHost(host: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(storageKeysFor(getPanel()).tenantHost, host);
}

/**
 * Evento global que se dispara cuando un request AUTENTICADO recibe 401
 * (token vencido o inválido). El `AuthProvider` lo escucha y cierra sesión +
 * redirige al login. Sin esto, si el token expira a mitad de sesión, el
 * usuario queda en un panel "logueado" donde todo falla en silencio.
 */
export const SESSION_EXPIRED_EVENT = 'casino:session-expired';

/** Dispara el evento de sesión expirada (lo escucha el AuthProvider). */
export function notifySessionExpired(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }
}

/**
 * Request al API. Tira `ApiError` en !ok.
 *
 * Uso:
 *   const data = await api<{ users: User[] }>('/tenant/users');
 *   const data = await api('/tenant/auth/login', { method: 'POST', json: {...} });
 */
async function parseResponse(res: Response): Promise<unknown> {
  const contentType = res.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  return isJson ? await res.json().catch(() => null) : null;
}

async function buildApiError(res: Response): Promise<ApiError> {
  const data = await parseResponse(res);
  return new ApiError({
    status: res.status,
    message:
      data && typeof data === 'object' && 'message' in data
        ? String(data.message)
        : res.statusText,
    code:
      data && typeof data === 'object' && 'error' in data
        ? String(data.error)
        : undefined,
    details: data,
  });
}

export async function api<T = unknown>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const { json, idempotencyKey, skipAuth, headers, timeoutMs, ...rest } = opts;

  const buildHeaders = (token: string | null): Record<string, string> => {
    const h: Record<string, string> = {
      Accept: 'application/json',
      // El backend lee `X-Tenant-Host` como override explícito del tenant.
      // NO usamos `X-Forwarded-Host` porque Next.js lo pisa al hacer
      // rewrite (lo setea con el host del cliente original = localhost:3001),
      // así que el header custom del fetch del cliente no llega al backend.
      'X-Tenant-Host': getTenantHost(),
      ...((headers as Record<string, string>) ?? {}),
    };
    if (json !== undefined) h['Content-Type'] = 'application/json';
    if (idempotencyKey) h['Idempotency-Key'] = idempotencyKey;
    // Un `Authorization` explícito en headers gana: el impersonate llama a
    // /me con el token recién emitido ANTES de que quede en storage del
    // panel destino, así que no puede depender del token de la sesión actual.
    if (!skipAuth && token && !h['Authorization']) {
      h['Authorization'] = `Bearer ${token}`;
    }
    return h;
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs ?? 30_000);

  const doRequest = (token: string | null): Promise<Response> =>
    fetch(`${API_BASE}${path}`, {
      ...rest,
      signal: controller.signal,
      headers: buildHeaders(token),
      body: json !== undefined ? JSON.stringify(json) : undefined,
    });

  const token = getToken();
  const res = await doRequest(token);
  clearTimeout(timeoutId);

  // Token vencido en request autenticado → intentar refresh UNA vez.
  // (En login mismo `skipAuth` es true, así que un 401 de credenciales
  // incorrectas NO entra por este camino.)
  // Solo disparar SESSION_EXPIRED si había token (evita redirect en guests).
  if (!res.ok && !skipAuth && res.status === 401) {
    if (token) {
      const newToken = await refreshAccessToken();
      if (newToken) {
        const retryRes = await doRequest(newToken);
        if (retryRes.ok) return (await parseResponse(retryRes)) as T;
      }
      notifySessionExpired();
    }
    throw await buildApiError(res);
  }

  if (!res.ok) throw await buildApiError(res);
  return (await parseResponse(res)) as T;
}

/** Helpers tipados para los verbos típicos. */
export const apiGet = <T = unknown>(path: string, opts?: RequestOptions) =>
  api<T>(path, { ...opts, method: 'GET' });

export const apiPost = <T = unknown>(
  path: string,
  json?: unknown,
  opts?: RequestOptions,
) => api<T>(path, { ...opts, method: 'POST', json });

export const apiPatch = <T = unknown>(
  path: string,
  json?: unknown,
  opts?: RequestOptions,
) => api<T>(path, { ...opts, method: 'PATCH', json });

export const apiPut = <T = unknown>(
  path: string,
  json?: unknown,
  opts?: RequestOptions,
) => api<T>(path, { ...opts, method: 'PUT', json });

export const apiDelete = <T = unknown>(path: string, opts?: RequestOptions) =>
  api<T>(path, { ...opts, method: 'DELETE' });

/**
 * Sprint 51.6: helper para uploads multipart/form-data. NO setea
 * `Content-Type` (el browser lo arma con el boundary correcto del
 * FormData). Reusa el mismo path de auth + tenant header del `api()`.
 */
export async function apiUpload<T = unknown>(
  path: string,
  formData: FormData,
): Promise<T> {
  const buildHeaders = (token: string | null): Record<string, string> => {
    const h: Record<string, string> = {
      Accept: 'application/json',
      'X-Tenant-Host': getTenantHost(),
    };
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  };

  const doRequest = (token: string | null): Promise<Response> =>
    fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: buildHeaders(token),
      body: formData,
    });

  const token = getToken();
  const res = await doRequest(token);

  if (!res.ok && res.status === 401) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      const retryRes = await doRequest(newToken);
      if (retryRes.ok) return (await parseResponse(retryRes)) as T;
    }
    notifySessionExpired();
    throw await buildApiError(res);
  }

  if (!res.ok) throw await buildApiError(res);
  return (await parseResponse(res)) as T;
}
