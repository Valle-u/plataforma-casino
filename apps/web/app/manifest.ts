/**
 * Manifest PWA (Sprint 55.x — operativa mobile).
 *
 * Habilita "Agregar a pantalla de inicio" en iOS Safari (requisito previo
 * para las push en iOS 16.4+) y el install prompt en Android/Chrome.
 *
 * Los iconos NO son estáticos: apuntan a `/icons/tenant-icon`, que arma un
 * cuadrado con la marca del tenant resolviéndolo por el header `Host`. Antes
 * eran los PNG del andamiaje (la "T" de Turborepo) y eso era lo que aparecía
 * al instalar la app en el iPhone. El comentario que estaba acá decía que el
 * icono del tenant "se inyecta dinámicamente desde el admin layout": ese
 * código nunca existió.
 *
 * El manifest es dinámico (lee `Host`) por dos motivos: el nombre debe ser el
 * del casino, y **el panel y la interfaz de jugador viven en hosts distintos
 * de la misma app**. Sin distinguirlos, quien instale los dos termina con dos
 * iconos idénticos y dos etiquetas iguales en la pantalla de inicio.
 */
import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';

interface TenantInfo {
  tenant?: { name?: string };
}

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const h = await headers();
  const host = (h.get('x-forwarded-host') ?? h.get('host') ?? '').split(':')[0] ?? '';
  const esPanel = host.startsWith('admin.') || host.startsWith('admin-');

  const nombreTenant = await traerNombre(host);
  const name = esPanel ? `Panel · ${nombreTenant}` : nombreTenant;
  const shortName = esPanel ? 'Panel' : (nombreTenant.split(' ')[0] ?? 'Casino');

  return {
    name,
    short_name: shortName,
    description: 'Tu reino. Tus reglas. Tu juego.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0a0a0a',
    theme_color: '#0a0a0a',
    categories: ['entertainment', 'games'],
    icons: [
      {
        src: '/icons/tenant-icon.png?size=192',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/tenant-icon.png?size=512',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      // `maskable`: Android recorta el icono a la forma del launcher. Como el
      // emblema va con `contain` sobre el fondo de marca, hay margen de sobra
      // y el recorte no se come nada.
      {
        src: '/icons/tenant-icon.png?size=512',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}

/** Nombre del casino. Si el backend no responde, un neutro de plataforma. */
async function traerNombre(host: string): Promise<string> {
  const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
  if (!host) return 'Casino';
  try {
    const res = await fetch(`${api}/tenant/info`, {
      headers: { Accept: 'application/json', 'X-Tenant-Host': host },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return 'Casino';
    const j = (await res.json()) as TenantInfo;
    return j.tenant?.name?.trim() || 'Casino';
  } catch {
    return 'Casino';
  }
}
