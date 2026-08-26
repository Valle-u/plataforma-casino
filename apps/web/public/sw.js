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
const VERSION = 'v1.6.1';

self.addEventListener('install', (event) => {
  // Sin pre-cache. NETWORK-ONLY (v1.5.0): el SW ya no cachea nada para no
  // servir bundles viejos durante el desarrollo. Solo existe para Web Push +
  // instalabilidad PWA. skipWaiting para activar de inmediato.
  console.log('[SW]', VERSION, 'network-only — instalando');
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  // Borrar TODOS los cachés viejos (shells de versiones anteriores) — ya no
  // usamos ninguno.
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// NETWORK-ONLY: no interceptamos las requests para cachear. Existe el handler
// (Chrome lo requiere para instalabilidad), pero deja pasar todo a la red —
// el navegador hace el fetch normal, siempre fresco.
self.addEventListener('fetch', () => {});

// Web Push removido temporalmente (la feature se quitó por errores; se
// retomará más adelante). Este SW solo queda para instalabilidad PWA.
