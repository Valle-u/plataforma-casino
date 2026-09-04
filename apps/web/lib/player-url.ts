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
  const esHostDeAdmin =
    host.startsWith('admin.') || host.startsWith('admin-');
  // 'admin.'.length === 'admin-'.length === 6
  const playerHost = esHostDeAdmin ? host.slice(6) : host;
  return `${protocol}//${playerHost}`;
}
