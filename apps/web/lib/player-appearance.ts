/**
 * player-appearance — propaga el diseño del jugador a los PORTALES.
 *
 * El layout de `/play` aplica los colores del tenant/socio como `style`
 * inline en su `<div>` contenedor. Pero los modales, menús y drawers se
 * renderizan en portales de Radix colgados de `<body>` (FUERA de ese
 * contenedor) → no heredan esas variables y caen al rosa del `:root`
 * (`globals.css`). Es el mismo problema que ya resolvió el panel admin
 * (`admin-appearance.ts` + clase `admin-neutral` en el body).
 *
 * Solución espejo: mientras el sitio del jugador está montado, se agrega
 * la clase `player-themed` al `<body>` y se inyecta una regla real
 * `.player-themed{…}` en el `<head>` con las mismas variables. Como la
 * regla apunta a `.player-themed` y el body lleva esa clase, los portales
 * (hijos del body) sí heredan los colores del socio.
 *
 * Solo variables `--color-*` (las que produce el layout): nada de props
 * CSS normales que puedan afectar el `<body>` de forma inesperada.
 */

export const PLAYER_THEME_CLASS = 'player-themed';

const STYLE_ID = 'player-design-vars';

/**
 * Escribe (o borra) una regla `.player-themed{…}` con las variables dadas.
 * Idempotente: reusa el mismo `<style>` en cada actualización.
 */
export function injectPlayerVars(vars: Record<string, string> | null): void {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById(STYLE_ID);
  if (!vars) {
    existing?.remove();
    return;
  }
  const body = Object.entries(vars)
    .filter(([k]) => k.startsWith('--'))
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
  if (!body) {
    existing?.remove();
    return;
  }
  const el =
    (existing as HTMLStyleElement | null) ?? document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = `.${PLAYER_THEME_CLASS}{${body}}`;
  if (!existing) document.head.appendChild(el);
}
