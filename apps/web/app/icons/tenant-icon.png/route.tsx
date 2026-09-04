/**
 * Icono de app del tenant, cuadrado y generado al vuelo.
 *
 * Problema que resuelve: al agregar el sitio a la pantalla de inicio del
 * iPhone salía **la "T" rosa de Turborepo** — el placeholder del andamiaje del
 * proyecto, que quedó en `public/icons/`. El favicon de la pestaña sí era el
 * del tenant (`lib/tenant-favicon.ts`), pero el icono de instalación no: el
 * comentario de `app/manifest.ts` decía que se inyectaba dinámicamente y **ese
 * código nunca existió**.
 *
 * Por qué generar la imagen en vez de servir el logo tal cual: los dos assets
 * de marca vienen con proporciones que no sirven como icono, y iOS **deforma**
 * lo que no sea cuadrado.
 *
 *   logoUrl     1949x807   (2.4:1)  — wordmark apaisado, ilegible a 180px
 *   faviconUrl  1024x1536  (0.67:1) — el emblema, vertical
 *
 * Se usa `faviconUrl` (el emblema, no el wordmark: a 180px un wordmark no se
 * lee) encajado con `contain` en un cuadrado sobre el fondo oscuro de la marca.
 * `contain` y no `cover` a propósito: recortar un emblema le come el borde y a
 * esta marca le comería la estrella de arriba y la punta de abajo.
 *
 * Se resuelve el tenant por el header `Host`, así que **la URL puede ser
 * relativa** y el manifest se mantiene simple: cada host pide su propio icono.
 *
 * `?size=` para los tamaños que pide cada plataforma (180 apple, 192/512 PWA).
 *
 * ⚠️ **El `.png` en la ruta NO es decorativo.** El matcher del middleware
 * excluye las rutas con extensión (`.*\.[\w]+$`); sin él, esta ruta entra al
 * middleware y en el host del jugador se la come el redirect a `/play` — el
 * icono devolvía HTML en vez de PNG. Se resolvió por acá y no tocando el
 * middleware, que ya tiene su historia de bugs sutiles.
 */

import { ImageResponse } from 'next/og';
import { headers } from 'next/headers';

/** Necesita Node: hace fetch al backend y decodifica PNG. */
export const runtime = 'nodejs';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

/** Fondo de la marca. Mismo `themeColor` que declara el layout. */
const FONDO = '#0a0a0a';

/** Tamaños permitidos. Se acota para no dejar un generador de imágenes abierto. */
const TAMAÑOS = new Set([180, 192, 256, 512]);
const TAMAÑO_DEFAULT = 180;

interface TenantInfo {
  tenant?: { name?: string };
  branding?: { faviconUrl?: string | null; logoUrl?: string | null };
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pedido = Number(url.searchParams.get('size'));
  const size = TAMAÑOS.has(pedido) ? pedido : TAMAÑO_DEFAULT;

  const h = await headers();
  const host = (h.get('x-forwarded-host') ?? h.get('host') ?? '').split(':')[0] ?? '';

  const info = await traerBranding(host);
  const src = resolverIcono(info, host, url.protocol);

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: '100%',
          alignItems: 'center',
          justifyContent: 'center',
          background: FONDO,
        }}
      >
        {src ? (
          <img
            src={src}
            width={size}
            height={size}
            // `contain` deja el emblema entero; el resto queda con el fondo
            // de marca, que es lo que iOS espera de un icono.
            style={{ objectFit: 'contain' }}
          />
        ) : (
          // Sin marca cargada: la inicial del tenant sobre el fondo. Feo pero
          // propio — cualquier cosa antes que el logo de otra empresa.
          <div
            style={{
              display: 'flex',
              fontSize: size * 0.5,
              fontWeight: 700,
              color: '#ffffff',
            }}
          >
            {(info?.tenant?.name ?? 'C').trim().charAt(0).toUpperCase()}
          </div>
        )}
      </div>
    ),
    {
      width: size,
      height: size,
      headers: {
        // El icono cambia sólo si el operador cambia su marca. Un día de caché
        // en el borde, y revalidación en background para que no haya un
        // request lento cuando expira.
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
      },
    },
  );
}

/** Branding público del tenant. Nunca tira: sin branding hay fallback. */
async function traerBranding(host: string): Promise<TenantInfo | null> {
  if (!host) return null;
  try {
    const res = await fetch(`${API_URL}/tenant/info`, {
      headers: { Accept: 'application/json', 'X-Tenant-Host': host },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    return (await res.json()) as TenantInfo;
  } catch {
    return null;
  }
}

/**
 * URL absoluta del emblema. Las de branding vienen relativas
 * (`/storage/files/...`) y las sirve el rewrite de la web, así que hay que
 * anteponerle el host — `ImageResponse` no resuelve rutas relativas.
 */
function resolverIcono(
  info: TenantInfo | null,
  host: string,
  protocol: string,
): string | null {
  // El emblema primero: el wordmark es apaisado y a 180px no se lee.
  const bruto = info?.branding?.faviconUrl ?? info?.branding?.logoUrl ?? null;
  if (!bruto || !host) return null;
  if (/^https?:\/\//i.test(bruto)) return bruto;
  return `${protocol}//${host}${bruto.startsWith('/') ? '' : '/'}${bruto}`;
}
