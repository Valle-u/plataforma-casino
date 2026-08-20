/**
 * BFF POST /api/auth/login — login que setea la sesión en cookies httpOnly.
 *
 * Reenvía el body (username/password/audience/2FA) al backend real; si autentica,
 * setea las cookies `casino_{panel}_{at,rt}` + el hint en el origen de Next. El
 * panel viene del header `X-Panel`. Propaga tal cual los errores del backend
 * (credenciales, 2FA requerido, rate limit) para que el form los muestre.
 */

import { NextResponse, type NextRequest } from 'next/server';
import {
  callBackend,
  forwardHeaders,
  panelFrom,
  setSessionCookies,
  upstreamUnreachable,
} from '@/lib/auth-cookies';

interface AuthResult {
  accessToken?: string;
  refreshToken?: string;
  user?: unknown;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const panel = panelFrom(req.headers.get('x-panel'));
  const body = await req.text();

  const upstream = await callBackend('/tenant/auth/login', {
    method: 'POST',
    headers: forwardHeaders(req),
    body,
  });
  if (!upstream) return upstreamUnreachable();

  const data = (await upstream.json().catch(() => null)) as AuthResult | null;

  if (!upstream.ok || !data?.accessToken || !data?.refreshToken) {
    // Propaga el error del backend (401 credenciales, 2FA, 429 rate limit, …).
    return NextResponse.json(data ?? { error: 'LOGIN_FAILED' }, {
      status: upstream.status || 502,
    });
  }

  const res = NextResponse.json({ ok: true, user: data.user });
  setSessionCookies(res, panel, data.accessToken, data.refreshToken);
  return res;
}
