/**
 * BFF POST /api/auth/impersonate/[userId] — el admin actúa "como" otro user.
 *
 * Usa la cookie `casino_admin_at` para autorizar contra el backend. El backend
 * emite tokens del impersonado; con ellos consultamos `/me` server-side para
 * decidir el panel destino (admin si el target accede al panel, player si no).
 * Respalda la sesión actual del panel destino en `casino_orig_*` (para volver)
 * y la pisa con los tokens del impersonado. Devuelve el user para que el cliente
 * redirija (/dashboard o /play) y muestre el banner.
 */

import { NextResponse, type NextRequest } from 'next/server';
import {
  backupSession,
  callBackend,
  cookieNames,
  forwardHeaders,
  setSessionCookies,
  upstreamUnreachable,
} from '@/lib/auth-cookies';

interface AuthResult {
  accessToken?: string;
  refreshToken?: string;
}
interface MeResult {
  user?: { canAccessPanel?: boolean } & Record<string, unknown>;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ userId: string }> },
): Promise<NextResponse> {
  const { userId } = await ctx.params;

  const adminAt = req.cookies.get(cookieNames('admin').at)?.value;
  if (!adminAt) {
    return NextResponse.json({ error: 'NO_ADMIN_SESSION' }, { status: 401 });
  }

  const body = await req.text();

  // 1. Impersonate contra el backend, autorizado con el token del admin.
  const imp = await callBackend(`/tenant/auth/impersonate/${userId}`, {
    method: 'POST',
    headers: { ...forwardHeaders(req), Authorization: `Bearer ${adminAt}` },
    body: body || '{}',
  });
  if (!imp) return upstreamUnreachable();
  const data = (await imp.json().catch(() => null)) as AuthResult | null;
  if (!imp.ok || !data?.accessToken || !data?.refreshToken) {
    return NextResponse.json(data ?? { error: 'IMPERSONATE_FAILED' }, {
      status: imp.status || 502,
    });
  }

  // 2. /me con el token del impersonado → panel destino.
  const meRes = await callBackend('/tenant/auth/me', {
    headers: { ...forwardHeaders(req), Authorization: `Bearer ${data.accessToken}` },
  });
  if (!meRes) return upstreamUnreachable();
  const me = (await meRes.json().catch(() => null)) as MeResult | null;
  if (!meRes.ok || !me?.user) {
    return NextResponse.json({ error: 'IMPERSONATE_ME_FAILED' }, { status: 502 });
  }
  const destPanel = me.user.canAccessPanel ? 'admin' : 'player';
  const names = cookieNames(destPanel);

  const res = NextResponse.json({ user: me.user });

  // 3. Backup de la sesión actual del panel destino (si la hay) para poder volver.
  const curAt = req.cookies.get(names.at)?.value;
  const curRt = req.cookies.get(names.rt)?.value;
  if (curAt && curRt) {
    backupSession(res, destPanel, curAt, curRt);
  }
  // 4. Pisar el panel destino con los tokens del impersonado.
  setSessionCookies(res, destPanel, data.accessToken, data.refreshToken);
  return res;
}
