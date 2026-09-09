/**
 * Origin público del JUGADOR, derivado del host actual.
 *
 * El panel se sirve en un host de admin (ver middleware.ts: `admin.` o
 * `admin-`); el jugador, en el host pelado. Los links que se comparten con
 * usuarios finales —referidos, campañas— se generan DESDE el panel, así que
 * `window.location.origin` apuntaría al host del panel: al abrirlo, el visitante
 * caería en el login del operador en vez de la interfaz del jugador.
 *
 * Este helper saca ese prefijo. Las dos formas miden 6 caracteres, así que un
 * solo `slice` sirve para las dos:
 *
 *   admin.miamihub.vip          → miamihub.vip           (producción)
 *   admin-staging.miamihub.vip  → staging.miamihub.vip   (staging)
 *
 * En dev (`localhost`) no hay subdominio admin: el host ya es el del jugador y
 * se devuelve intacto, así que los links siguen funcionando por path.
 */
export function playerOrigin(): string {
  if (typeof window === 'undefined') return '';
  const { protocol, host } = window.location;
  return `${protocol}//${sacarPrefijo(host)}`;
}

/**
 * Los prefijos de host que NO son el del jugador.
 *
 * ⚠️ **Se sacan por longitud del prefijo, no con un `slice` fijo.** Antes había
 * un `slice(6)` con el comentario *"'admin.' y 'admin-' miden 6"* — cierto, pero
 * dejó de alcanzar cuando apareció `crm.`, que mide 4. Con el número cableado,
 * `crm.miamihub.vip` habría quedado en `iamihub.vip`.
 */
const PREFIJOS = ['admin.', 'admin-', 'crm.', 'crm-'];

/**
 * El host del jugador a partir del host actual.
 *
 *   admin.miamihub.vip          → miamihub.vip
 *   admin-staging.miamihub.vip  → staging.miamihub.vip
 *   crm.miamihub.vip            → miamihub.vip
 *   crm-staging.miamihub.vip    → staging.miamihub.vip
 *   localhost:3001              → localhost:3001   (dev, sin subdominio)
 */
function sacarPrefijo(host: string): string {
  const h = host.toLowerCase();
  const prefijo = PREFIJOS.find((p) => h.startsWith(p));
  return prefijo ? host.slice(prefijo.length) : host;
}
