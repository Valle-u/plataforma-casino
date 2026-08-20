/**
 * BFF POST /api/auth/register — registro de jugador con auto-login por cookie.
 *
 * Proxya el body al backend real (que crea el user y emite tokens) y setea las
 * cookies de sesión del panel (siempre player, por `X-Panel`). Propaga los
 * errores del backend (username tomado, registro cerrado, etc.).
 */

import { NextResponse, type NextRequest } from 'next/server';
import {
  BACKEND_URL,
  forwardHeaders,
  panelFrom,
  setSessionCookies,
} from '@/lib/auth-cookies';

interface AuthResult {
  accessToken?: string;
  refreshToken?: string;
  user?: unknown;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const panel = panelFrom(req.headers.get('x-panel'));
  const body = await req.text();

  const upstream = await fetch(`${BACKEND_URL}/tenant/auth/register`, {
    method: 'POST',
    headers: forwardHeaders(req),
    body,
  });

  const data = (await upstream.json().catch(() => null)) as AuthResult | null;

  if (!upstream.ok || !data?.accessToken || !data?.refreshToken) {
    return NextResponse.json(data ?? { error: 'REGISTER_FAILED' }, {
      status: upstream.status || 502,
    });
  }

  const res = NextResponse.json({ ok: true, user: data.user });
  setSessionCookies(res, panel, data.accessToken, data.refreshToken);
  return res;
}
