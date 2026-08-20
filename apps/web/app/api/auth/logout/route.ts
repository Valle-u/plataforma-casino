/**
 * BFF POST /api/auth/logout — revoca la sesión en el backend (best-effort) y
 * limpia todas las cookies de sesión del panel (incluye backup de impersonate).
 *
 * El panel viene del header `X-Panel`. Siempre limpia las cookies localmente,
 * aunque la revocación remota falle.
 */

import { NextResponse, type NextRequest } from 'next/server';
import {
  callBackend,
  clearSessionCookies,
  cookieNames,
  forwardHeaders,
  panelFrom,
} from '@/lib/auth-cookies';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const panel = panelFrom(req.headers.get('x-panel'));
  const names = cookieNames(panel);
  const refreshToken = req.cookies.get(names.rt)?.value;

  if (refreshToken) {
    // Best-effort: revoca la sesión en el backend. No bloqueamos el logout si falla.
    await callBackend('/tenant/auth/logout', {
      method: 'POST',
      headers: forwardHeaders(req),
      body: JSON.stringify({ refreshToken }),
    });
  }

  const res = NextResponse.json({ ok: true });
  clearSessionCookies(res, panel);
  return res;
}
