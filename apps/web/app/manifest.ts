/**
 * Manifest PWA (Sprint 55.x — operativa mobile).
 *
 * Habilita "Agregar a pantalla de inicio" en iOS Safari (requisito previo
 * para las push en iOS 16.4+) y el install prompt en Android/Chrome.
 *
 * Nota: la marca real del tenant es dinámica (branding.logoUrl). Los iconos
 * acá son el default de plataforma; el `apple-touch-icon` específico del
 * tenant se inyecta dinámicamente desde el admin layout (mismo patrón que
 * el favicon). Para Android/Chrome el manifest es estático por diseño.
 */
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Plataforma Casino',
    short_name: 'Casino',
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
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
