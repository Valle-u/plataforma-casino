/**
 * BFF POST /api/auth/logout — revoca la sesión en el backend (best-effort) y
 * limpia todas las cookies de sesión del panel (incluye backup de impersonate).
 *
 * El panel viene del header `X-Panel`. Siempre limpia las cookies localmente,
 * aunque la revocación remota falle.
 */

import { NextResponse, after, type NextRequest } from 'next/server';
import {
  callBackend,
  clearSessionCookies,
  cookieNames,
  forwardHeaders,
  panelFrom,
} from '@/lib/auth-cookies';

export function POST(req: NextRequest): NextResponse {
  const panel = panelFrom(req.headers.get('x-panel'));
  const names = cookieNames(panel);
  const refreshToken = req.cookies.get(names.rt)?.value;

  // Respondemos YA con las cookies limpias (el cliente espera este logout antes
  // de navegar, para que el middleware no re-emita la sesión). La revocación en
  // el backend corre DESPUÉS de la respuesta (best-effort) con `after()`: así el
  // logout es instantáneo y no espera el round-trip al backend.
  const res = NextResponse.json({ ok: true });
  clearSessionCookies(res, panel);

  if (refreshToken) {
    const headers = forwardHeaders(req);
    after(async () => {
      await callBackend('/tenant/auth/logout', {
        method: 'POST',
        headers,
        body: JSON.stringify({ refreshToken }),
      }).catch(() => {
        // best-effort: si el revoke remoto falla, las cookies ya se limpiaron.
      });
    });
  }

  return res;
}
