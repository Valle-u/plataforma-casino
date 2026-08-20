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

import type { NextResponse } from 'next/server';

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
