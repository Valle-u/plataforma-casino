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
 *
 *  3. **Pasa la IP real del jugador** al backend en `x-player-ip`, para las
 *     rutas `/api/tenant/*` y `/api/player/*` que `next.config.ts` proxea.
 *     Ver `IP_JUGADOR` más abajo: es el único lugar del sistema donde esa IP
 *     todavía se conoce.
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
 * Header con el que le pasamos al backend la IP REAL del jugador.
 *
 * Hace falta porque `next.config.ts` proxea `/api/tenant/*` con un *rewrite*,
 * y **los rewrites de Next corren en el servidor**. La cadena real es:
 *
 *   navegador → Cloudflare → Next (nuestro VPS) → Cloudflare → API
 *
 * En el segundo salto el cliente somos nosotros, así que Cloudflare pisa el
 * `CF-Connecting-IP` con la IP del VPS y el backend guardaba eso. Verificado
 * en producción: las sesiones de juego quedaban con `147.93.32.111`, y antes
 * con IPs de Cloudflare compartidas por 5–8 usuarios distintos.
 *
 * Acá, en cambio, estamos sobre la request ORIGINAL del navegador: el
 * `CF-Connecting-IP` es el del jugador de verdad. Es el único punto del
 * sistema donde esa IP todavía existe.
 *
 * ⚠️ El backend confía en este header. Hoy el origen acepta conexiones
 * directas, así que alguien que le pegue derecho podría falsearlo — igual que
 * ya podía falsear `X-Forwarded-For`. Lo cierra la fase 2 de
 * `docs/25-seguridad-cloudflare.md` (firewall del VPS a rangos de CF).
 */
const IP_JUGADOR = 'x-player-ip';

/** La IP del visitante, tal como la ve la request original del navegador. */
function ipDelJugador(req: NextRequest): string | null {
  const cf = req.headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf;
  const fwd = req.headers.get('x-forwarded-for');
  return fwd?.split(',')[0]?.trim() || null;
}

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
  const ip = ipDelJugador(req);
  if (ip) requestHeaders.set(IP_JUGADOR, ip);

  // Las rutas proxeadas no son navegaciones: no necesitan panel, ni el
  // redirect por subdominio, ni el refresh de cookies (el api-client refresca
  // por su cuenta). Sólo pasan por acá para llevarse la IP, así que se sale
  // temprano y no se les agrega latencia.
  if (pathname.startsWith('/api/')) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  requestHeaders.set('x-panel', panel);
  requestHeaders.set('x-pathname', pathname);

  // ── Routing por subdominio ──────────────────────────────────────────────
  // El PANEL solo se accede por un host de admin. En el host del JUGADOR
  // (dominio pelado / www.), el root y CUALQUIER ruta de panel redirigen a la
  // interfaz de jugador — así `miamihub.vip` abre el casino, no el login del
  // panel, y el panel no es accesible desde ahí.
  //
  // Se aceptan DOS formas, `admin.` y `admin-`:
  //   - `admin.miamihub.vip`        → producción
  //   - `admin-staging.miamihub.vip` → staging
  //
  // El guion existe porque `admin.staging.miamihub.vip` es un subdominio de dos
  // niveles y el certificado universal de Cloudflare (plan free) sólo cubre uno.
  // Con guion sigue siendo un nivel, el cert lo cubre y el proxy queda activo.
  //
  // ⚠️ Sin el caso del guion, staging redirige TODO a `/play` y el panel es
  //    inalcanzable — pasó el 2026-09-04 al montar el entorno.
  //
  // Excepción: dev (localhost) no tiene subdominio admin, así que ahí el panel
  // se accede por path (`/login`).
  const host = (req.headers.get('host') ?? '').toLowerCase();
  const isLocalhost =
    host.includes('localhost') ||
    host.startsWith('127.') ||
    host.includes('0.0.0.0');
  const isAdminHost = host.startsWith('admin.') || host.startsWith('admin-');
  if (!isLocalhost && !isAdminHost) {
    const isPlayerRoute =
      pathname.startsWith('/play') || pathname.startsWith('/r/');
    if (!isPlayerRoute) {
      return NextResponse.redirect(new URL('/play', req.url));
    }
  }

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
      const upstream = await callBackend(
        '/tenant/auth/refresh',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // Las navegaciones top-level NO mandan X-Tenant-Host (solo el
            // api-client en /api/*), así que lo inyectamos desde el env.
            'X-Tenant-Host': TENANT_HOST,
            ...(req.headers.get('x-forwarded-for')
              ? {
                  'X-Forwarded-For': req.headers.get(
                    'x-forwarded-for',
                  ) as string,
                }
              : {}),
          },
          body: JSON.stringify({ refreshToken: rt }),
        },
        // Bloquea la navegación → timeout corto; si el backend tarda más,
        // seguimos sin refrescar (fail-open) y el cliente refresca después.
        5000,
      );
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
  // Rutas de página: todas EXCEPTO assets de _next, los handlers /api (los BFF
  // refrescan por su cuenta) y archivos con extensión (estáticos).
  //
  // Y además las dos rutas que `next.config.ts` proxea al backend, que entran
  // sólo para llevarse `x-player-ip` (ver arriba). Sin esto el backend nunca
  // ve la IP del jugador.
  matcher: [
    '/((?!_next/|api/|.*\\.[\\w]+$).*)',
    '/api/tenant/:path*',
    '/api/player/:path*',
  ],
};
