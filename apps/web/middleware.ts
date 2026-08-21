/**
 * Middleware de Next — auth server-aware (Item A, Etapa 2, Fase A).
 *
 * Corre antes del render (edge). Hace dos cosas, ambas fail-open:
 *
 *  1. Setea headers `x-panel` (admin|player, derivado de la ruta) y `x-pathname`
 *     en el request reenviado, para que los server components los lean con
 *     `headers()` (necesario para resolver el user y el panel server-side).
 *
 *  2. **Refresh server-side de la sesión**: si el access token de la cookie
 *     httpOnly (`casino_{panel}_at`) venció y hay refresh token
 *     (`casino_{panel}_rt`), rota el par contra el backend y setea las cookies
 *     nuevas. Es el ÚNICO lugar donde se puede rotar la cookie durante el SSR
 *     (los server components no pueden escribir cookies). El backend verifica la
 *     firma del token nuevo; acá solo leemos `exp` para decidir si refrescar.
 *
 * Fase A es aditiva: no cambia el comportamiento del render (el seed del user
 * viene en la Fase B). Cualquier fallo → `NextResponse.next()` sin refrescar.
 */

import { NextResponse, type NextRequest } from 'next/server';
import {
  callBackend,
  cookieNames,
  setSessionCookies,
  type Panel,
} from '@/lib/auth-cookies';

const TENANT_HOST = process.env.NEXT_PUBLIC_TENANT_HOST ?? '';

/**
 * ¿El JWT venció (o vence dentro de `skewSec`)? Solo decodifica el payload para
 * leer `exp` (base64url → `atob`, disponible en edge). NO verifica la firma —
 * eso lo hace el backend con el token refrescado. Ante cualquier duda: expirado.
 */
function isJwtExpired(token: string, skewSec = 30): boolean {
  const parts = token.split('.');
  if (parts.length < 2 || !parts[1]) return true;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const payload = JSON.parse(json) as { exp?: number };
    if (typeof payload.exp !== 'number') return true;
    return Date.now() / 1000 >= payload.exp - skewSec;
  } catch {
    return true;
  }
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  const panel: Panel = pathname.startsWith('/play') ? 'player' : 'admin';

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-panel', panel);
  requestHeaders.set('x-pathname', pathname);

  // En las pantallas de login NO refrescamos: si el usuario está desloqueándose
  // (el logout limpia las cookies y navega a /login), un refresh acá vería el
  // refresh token todavía presente y RE-EMITIRÍA la sesión → re-logueo automático.
  const isLoginRoute = pathname === '/login' || pathname === '/play/login';

  try {
    const names = cookieNames(panel);
    const at = req.cookies.get(names.at)?.value;
    const rt = req.cookies.get(names.rt)?.value;

    // Solo refrescamos si hay refresh token y el access venció (o está por vencer).
    if (!isLoginRoute && rt && (!at || isJwtExpired(at))) {
      const upstream = await callBackend('/tenant/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Las navegaciones top-level NO mandan X-Tenant-Host (solo el
          // api-client en /api/*), así que lo inyectamos desde el env.
          'X-Tenant-Host': TENANT_HOST,
          ...(req.headers.get('x-forwarded-for')
            ? { 'X-Forwarded-For': req.headers.get('x-forwarded-for') as string }
            : {}),
        },
        body: JSON.stringify({ refreshToken: rt }),
      });
      const data = upstream?.ok
        ? ((await upstream.json().catch(() => null)) as {
            accessToken?: string;
            refreshToken?: string;
          } | null)
        : null;

      if (data?.accessToken && data?.refreshToken) {
        // (a) que el cookies() del render vea el token nuevo en ESTE request.
        req.cookies.set(names.at, data.accessToken);
        requestHeaders.set('cookie', req.cookies.toString());
        const res = NextResponse.next({ request: { headers: requestHeaders } });
        // (b) que el browser guarde el par nuevo para los próximos requests.
        setSessionCookies(res, panel, data.accessToken, data.refreshToken);
        return res;
      }
    }
  } catch {
    // Fail-open: nunca romper el request por un problema del refresh.
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  // Corre en todas las rutas de página, EXCEPTO: assets de _next, los handlers
  // /api (los BFF refrescan por su cuenta), y archivos con extensión (estáticos).
  matcher: ['/((?!_next/|api/|.*\\.[\\w]+$).*)'],
};
