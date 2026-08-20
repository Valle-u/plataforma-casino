/**
 * BFF POST /api/auth/refresh — rota la sesión leyendo el refresh token de la
 * cookie httpOnly (el JS del cliente no puede leerlo) y seteando el par nuevo.
 *
 * Bodyless: el panel viene del header `X-Panel`. Si no hay cookie de refresh o
 * el backend la rechaza, limpia las cookies y devuelve 401 (el cliente cae a
 * "sesión expirada").
 */

import { NextResponse, type NextRequest } from 'next/server';
import {
  BACKEND_URL,
  clearSessionCookies,
  cookieNames,
  forwardHeaders,
  panelFrom,
  setSessionCookies,
} from '@/lib/auth-cookies';

interface AuthResult {
  accessToken?: string;
  refreshToken?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const panel = panelFrom(req.headers.get('x-panel'));
  const names = cookieNames(panel);
  const refreshToken = req.cookies.get(names.rt)?.value;

  if (!refreshToken) {
    const res = NextResponse.json({ error: 'NO_SESSION' }, { status: 401 });
    clearSessionCookies(res, panel);
    return res;
  }

  const upstream = await fetch(`${BACKEND_URL}/tenant/auth/refresh`, {
    method: 'POST',
    headers: forwardHeaders(req),
    body: JSON.stringify({ refreshToken }),
  });

  const data = (await upstream.json().catch(() => null)) as AuthResult | null;

  if (!upstream.ok || !data?.accessToken || !data?.refreshToken) {
    const res = NextResponse.json({ error: 'REFRESH_FAILED' }, { status: 401 });
    clearSessionCookies(res, panel);
    return res;
  }

  const res = NextResponse.json({ ok: true });
  setSessionCookies(res, panel, data.accessToken, data.refreshToken);
  return res;
}
