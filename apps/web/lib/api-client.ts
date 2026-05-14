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
const TOKEN_STORAGE_KEY = 'casino_admin_token';
const TENANT_HOST_STORAGE_KEY = 'casino_admin_tenant_host';

/** Default del tenant host en dev — lo lee de env o cae al demo tenant. */
const DEFAULT_TENANT_HOST =
  process.env.NEXT_PUBLIC_TENANT_HOST ?? 'demo.localhost';

export interface ApiError {
  status: number;
  message: string;
  code?: string;
  /** Payload original del backend (issues, validation errors, etc.) */
  details?: unknown;
}

export function isApiError(err: unknown): err is ApiError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    typeof (err as { status: unknown }).status === 'number'
  );
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  /** Body que se va a JSON.stringify. */
  json?: unknown;
  /** Header de idempotency-key para mutaciones. */
  idempotencyKey?: string;
  /** Skip auth header (e.g. para login mismo). */
  skipAuth?: boolean;
}

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  else window.localStorage.removeItem(TOKEN_STORAGE_KEY);
}

export function getTenantHost(): string {
  if (typeof window === 'undefined') return DEFAULT_TENANT_HOST;
  return (
    window.localStorage.getItem(TENANT_HOST_STORAGE_KEY) ?? DEFAULT_TENANT_HOST
  );
}

export function setTenantHost(host: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TENANT_HOST_STORAGE_KEY, host);
}

/**
 * Request al API. Tira `ApiError` en !ok.
 *
 * Uso:
 *   const data = await api<{ users: User[] }>('/tenant/users');
 *   const data = await api('/tenant/auth/login', { method: 'POST', json: {...} });
 */
export async function api<T = unknown>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const { json, idempotencyKey, skipAuth, headers, ...rest } = opts;

  const reqHeaders: Record<string, string> = {
    Accept: 'application/json',
    // El backend honra X-Forwarded-Host como override del tenant (cuando
    // el proxy lo agrega — en dev lo seteamos nosotros para que el web
    // en :3001 pueda hablar con el backend resolviendo al tenant correcto).
    'X-Forwarded-Host': getTenantHost(),
    ...((headers as Record<string, string>) ?? {}),
  };

  if (json !== undefined) {
    reqHeaders['Content-Type'] = 'application/json';
  }
  if (idempotencyKey) {
    reqHeaders['Idempotency-Key'] = idempotencyKey;
  }
  if (!skipAuth) {
    const token = getToken();
    if (token) reqHeaders['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: reqHeaders,
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });

  const contentType = res.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const err: ApiError = {
      status: res.status,
      message:
        (data && typeof data === 'object' && 'message' in data
          ? String((data as { message: unknown }).message)
          : null) ?? res.statusText,
      code:
        data && typeof data === 'object' && 'error' in data
          ? String((data as { error: unknown }).error)
          : undefined,
      details: data,
    };
    throw err;
  }

  return data as T;
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

export const apiDelete = <T = unknown>(path: string, opts?: RequestOptions) =>
  api<T>(path, { ...opts, method: 'DELETE' });
