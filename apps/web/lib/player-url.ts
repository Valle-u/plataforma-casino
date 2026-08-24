/**
 * Origin público del JUGADOR, derivado del host actual.
 *
 * El panel se sirve en `admin.<dominio>` (ver middleware.ts: `isAdminHost =
 * host.startsWith('admin.')`); el jugador, en el dominio pelado. Los links que
 * se comparten con usuarios finales —referidos, campañas— se generan DESDE el
 * panel, así que `window.location.origin` apuntaría a `admin.<dominio>`: al
 * abrirlo, el visitante cae en el host del panel (login del operador) en vez de
 * la interfaz del jugador. Este helper devuelve el origin del jugador quitando
 * el prefijo `admin.` si está presente.
 *
 * Casos sin subdominio admin (panel por path): dev (`localhost`) y staging
 * (`*.vercel.app`). Ahí el host ya es el del jugador y se devuelve intacto, así
 * que los links siguen funcionando por path (`/r/...`, `/play`).
 */
export function playerOrigin(): string {
  if (typeof window === 'undefined') return '';
  const { protocol, host } = window.location;
  const playerHost = host.startsWith('admin.')
    ? host.slice('admin.'.length)
    : host;
  return `${protocol}//${playerHost}`;
}
