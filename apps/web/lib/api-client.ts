/**
 * API client — wrapper fino sobre fetch que:
 *   - Setea el tenant correcto via header `X-Tenant-Host`.
 *   - Manda el header `X-Panel` (admin|player) para que el backend elija la
 *     cookie de sesión correcta (admin y player conviven en el mismo origen).
 *   - Maneja respuestas no-2xx tirando un `ApiError` tipado.
 *   - Pasa por el rewrite de Next.js (/api/* → backend).
 *
 * Autenticación por COOKIE httpOnly (Item A): el token de sesión NO vive en
 * localStorage ni se manda en `Authorization` — viaja en la cookie httpOnly
 * `casino_{panel}_at`, que el navegador manda sola (same-origin) y el rewrite
 * reenvía al backend. El JS no puede leerla; para saber si hay sesión se usa
 * la "hint cookie" legible `casino_{panel}_session` (ver `hasSessionHint`).
 * Login/refresh/logout pasan por los handlers BFF de `/api/auth/*`, que setean
 * las cookies en el origen de Next.
 *
 * El backend resuelve el tenant por header (`X-Tenant-Host`); en prod cada
 * tenant es su dominio, en dev se usa el default de `NEXT_PUBLIC_TENANT_HOST`.
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

/** Key del override manual de tenant host (localStorage) por panel. */
function tenantHostKey(panel: 'admin' | 'player'): string {
  return panel === 'admin'
    ? 'casino_admin_tenant_host'
    : 'casino_player_tenant_host';
}

/**
 * ¿Hay sesión para el panel? El token vive en una cookie httpOnly que el JS no
 * puede leer; el BFF setea además una "hint cookie" legible `casino_{panel}_session`
 * cuya sola presencia indica sesión activa. Reemplaza al viejo `getToken()`.
 */
export function hasSessionHint(panel: 'admin' | 'player' = getPanel()): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie
    .split(';')
    .some((c) => c.trim().startsWith(`casino_${panel}_session=`));
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

/** Promise global para evitar múltiples refresh simultáneos (anti-stampede). */
let refreshPromise: Promise<boolean> | null = null;

/**
 * Rota la sesión vía el handler BFF `/api/auth/refresh`, que lee el refresh
 * token de la cookie httpOnly (el JS no puede) y setea el par nuevo. No maneja
 * tokens en JS: devuelve `true` si se refrescó (la cookie nueva viaja sola en
 * el retry), `false` si no. El panel se manda en `X-Panel`.
 */
export async function refreshAccessToken(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;

  if (!hasSessionHint(getPanel())) return false;

  refreshPromise = (async (): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: {
          'X-Tenant-Host': getTenantHost(),
          'X-Panel': getPanel(),
        },
        credentials: 'same-origin',
      });
      return res.ok;
    } catch {
      return false;
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
    tenantHostKey(getPanel()) + '_override',
  );
  return override ?? DEFAULT_TENANT_HOST;
}

export function setTenantHost(host: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(tenantHostKey(getPanel()), host);
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

  const buildHeaders = (): Record<string, string> => {
    const h: Record<string, string> = {
      Accept: 'application/json',
      // Tenant: el backend lee `X-Tenant-Host` como override explícito (Next
      // pisa X-Forwarded-Host en el rewrite). Panel: `X-Panel` le dice al
      // backend cuál cookie de sesión leer (admin/player conviven en el origen).
      'X-Tenant-Host': getTenantHost(),
      'X-Panel': getPanel(),
      ...((headers as Record<string, string>) ?? {}),
    };
    if (json !== undefined) h['Content-Type'] = 'application/json';
    if (idempotencyKey) h['Idempotency-Key'] = idempotencyKey;
    return h;
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs ?? 30_000);

  const doRequest = (): Promise<Response> =>
    fetch(`${API_BASE}${path}`, {
      ...rest,
      signal: controller.signal,
      // La cookie httpOnly de sesión viaja sola (same-origin).
      credentials: 'same-origin',
      headers: buildHeaders(),
      body: json !== undefined ? JSON.stringify(json) : undefined,
    });

  const res = await doRequest();
  clearTimeout(timeoutId);

  // 401 en request autenticado → intentar refresh (rota la cookie) UNA vez.
  // (login/refresh usan `skipAuth`, así que un 401 de credenciales NO entra acá.)
  // Solo si hay hint de sesión (evita redirect en guests).
  if (!res.ok && !skipAuth && res.status === 401) {
    if (hasSessionHint(getPanel())) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        const retryRes = await doRequest();
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
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Tenant-Host': getTenantHost(),
    'X-Panel': getPanel(),
  };

  const doRequest = (): Promise<Response> =>
    fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers,
      // La cookie httpOnly de sesión viaja sola (same-origin).
      credentials: 'same-origin',
      body: formData,
    });

  const res = await doRequest();

  if (!res.ok && res.status === 401) {
    if (hasSessionHint(getPanel())) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        const retryRes = await doRequest();
        if (retryRes.ok) return (await parseResponse(retryRes)) as T;
      }
      notifySessionExpired();
    }
    throw await buildApiError(res);
  }

  if (!res.ok) throw await buildApiError(res);
  return (await parseResponse(res)) as T;
}
