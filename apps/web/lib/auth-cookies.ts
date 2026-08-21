/**
 * Helpers server-side para la sesión en cookies httpOnly (BFF).
 *
 * Migración del token de sesión de localStorage → cookie httpOnly (Item A).
 * Los route handlers de `app/api/auth/*` llaman al backend real, reciben los
 * tokens en el body, y setean/limpian estas cookies en el ORIGEN de Next (por
 * eso las setea Next, no el backend → control total sobre los atributos).
 *
 * Cookies POR PANEL (admin/player conviven en el mismo origen):
 *   - casino_{panel}_at   — access token (httpOnly)
 *   - casino_{panel}_rt   — refresh token (httpOnly)
 *   - casino_{panel}_session — "hint" legible por JS (solo presencia; el
 *       cliente la usa para saber si hay sesión, ya que no puede leer las httpOnly)
 *   - casino_orig_{panel}_{at,rt} — backup para impersonate (httpOnly)
 *
 * Host-only (sin atributo Domain) → no se comparte entre dominios de tenants.
 */

import { NextResponse } from 'next/server';

export const BACKEND_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

const isProd = process.env.NODE_ENV === 'production';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 días (vida del refresh token)

export type Panel = 'admin' | 'player';

export function panelFrom(value: string | null | undefined): Panel {
  return value === 'player' ? 'player' : 'admin';
}

export function cookieNames(panel: Panel) {
  return {
    at: `casino_${panel}_at`,
    rt: `casino_${panel}_rt`,
    hint: `casino_${panel}_session`,
    origAt: `casino_orig_${panel}_at`,
    origRt: `casino_orig_${panel}_rt`,
  };
}

const base = { secure: isProd, sameSite: 'lax' as const, path: '/' };
const httpOnly = { ...base, httpOnly: true, maxAge: MAX_AGE };
const hint = { ...base, httpOnly: false, maxAge: MAX_AGE };

/** Setea las cookies de sesión (at + rt httpOnly + hint legible) del panel. */
export function setSessionCookies(
  res: NextResponse,
  panel: Panel,
  accessToken: string,
  refreshToken: string,
): void {
  const n = cookieNames(panel);
  res.cookies.set(n.at, accessToken, httpOnly);
  res.cookies.set(n.rt, refreshToken, httpOnly);
  res.cookies.set(n.hint, '1', hint);
}

/** Limpia todas las cookies de sesión del panel (incluye backup de impersonate). */
export function clearSessionCookies(res: NextResponse, panel: Panel): void {
  const n = cookieNames(panel);
  for (const name of [n.at, n.rt, n.origAt, n.origRt]) {
    res.cookies.set(name, '', { ...httpOnly, maxAge: 0 });
  }
  res.cookies.set(n.hint, '', { ...hint, maxAge: 0 });
}

/**
 * Guarda la sesión actual del panel en las cookies de backup `casino_orig_*`
 * (impersonate): permite volver a la sesión previa con stop-impersonating.
 */
export function backupSession(
  res: NextResponse,
  panel: Panel,
  accessToken: string,
  refreshToken: string,
): void {
  const n = cookieNames(panel);
  res.cookies.set(n.origAt, accessToken, httpOnly);
  res.cookies.set(n.origRt, refreshToken, httpOnly);
}

/** Borra solo las cookies de backup del panel (tras restaurar). */
export function clearBackup(res: NextResponse, panel: Panel): void {
  const n = cookieNames(panel);
  res.cookies.set(n.origAt, '', { ...httpOnly, maxAge: 0 });
  res.cookies.set(n.origRt, '', { ...httpOnly, maxAge: 0 });
}

/**
 * Fetch al backend que NO tira: devuelve la Response, o `null` si el fetch
 * falló (backend inalcanzable, DNS, timeout). Los handlers BFF lo usan para
 * responder un 502 limpio en vez de un 500 pelado de Next.
 *
 * TIMEOUT (default 8s): sin esto, un backend LENTO (no caído — el caso común
 * de sobrecarga) no tira, y el fetch queda colgado indefinidamente. Como el
 * middleware llama a esto en CADA navegación (para refrescar la sesión) y
 * bloquea el render, un backend lento cascadea en pile-up de requests. Con el
 * AbortController el fetch se corta y el caller cae al fail-open (null). El
 * middleware pasa un timeout más corto porque bloquea la navegación del usuario.
 */
export async function callBackend(
  path: string,
  init: RequestInit,
  timeoutMs = 8000,
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${BACKEND_URL}${path}`, {
      ...init,
      signal: init.signal ?? controller.signal,
    });
  } catch {
    // Incluye el AbortError del timeout → el caller lo trata como "backend
    // inalcanzable" (fail-open en el middleware, 502 en los BFF).
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 502 JSON estándar cuando el BFF no puede contactar al backend. */
export function upstreamUnreachable(): NextResponse {
  return NextResponse.json(
    {
      error: 'UPSTREAM_UNREACHABLE',
      message: 'No se pudo contactar al servidor. Probá de nuevo.',
    },
    { status: 502 },
  );
}

/**
 * Headers de identidad a reenviar del request entrante del navegador hacia el
 * backend: el tenant (X-Tenant-Host) y la IP real del usuario (X-Forwarded-For
 * / X-Real-IP) — el backend rate-limitea y audita por IP; sin esto vería la IP
 * del server de Next. `Content-Type: application/json` para los POST con body.
 */
export function forwardHeaders(req: Request): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const tenant = req.headers.get('x-tenant-host');
  if (tenant) h['X-Tenant-Host'] = tenant;
  const xff = req.headers.get('x-forwarded-for');
  if (xff) h['X-Forwarded-For'] = xff;
  const realIp = req.headers.get('x-real-ip');
  if (realIp) h['X-Real-IP'] = realIp;
  return h;
}
