/**
 * Service worker — plataforma (PWA, Sprint 55.x).
 *
 * Roles:
 *   1. Habilitar "instalabilidad" (Chrome requiere SW con fetch handler).
 *   2. Vehículo de las Web Push en iOS 16.4+ (solo funcionan con la app
 *      instalada en pantalla de inicio).
 *   3. Caché defensiva mínima del app shell. La API queda SIEMPRE
 *      network-only (el panel opera datos en tiempo real; cachearla
 *      arriesga stale data / problemas de auth).
 *
 * Estrategia de caché:
 *   - Navegaciones (/...): network-first con fallback al app shell cacheado.
 *   - Estáticos same-origin (_next/, imágenes): stale-while-revalidate.
 *   - API (/api/, /tenant/, /player/, /storage/): network-only.
 *
 * Bump `VERSION` al cambiar el contenido para que los clientes
 * actualizados descarten el caché viejo.
 */
const VERSION = 'v1.0.0';
const SHELL_CACHE = `casino-shell-${VERSION}`;

const API_PREFIXES = ['/api/', '/tenant/', '/player/', '/storage/'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(['/']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('casino-shell-') && k !== SHELL_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API + storage: nunca cachear.
  if (API_PREFIXES.some((p) => url.pathname.startsWith(p))) return;

  // Navegaciones: network-first, fallback al shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put('/', copy));
          return res;
        })
        .catch(() =>
          caches
            .open(SHELL_CACHE)
            .then((cache) => cache.match('/'))
            .then((cached) => cached || Response.error()),
        ),
    );
    return;
  }

  // Estáticos same-origin: stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});

/**
 * Web Push (Fase 3): muestra la notificación. El payload es JSON con
 * `{ title, body, url, icon? }`. Si no es parseable, usa texto plano.
 */
self.addEventListener('push', (event) => {
  let payload: { title?: string; body?: string; url?: string; icon?: string } | null = null;
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { body: event.data.text() };
    }
  }
  const title = payload?.title || 'Plataforma Casino';
  const options = {
    body: payload?.body || '',
    icon: payload?.icon || '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: payload?.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
