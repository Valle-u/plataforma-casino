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

/**
 * Tokens DERIVADOS del acento (gradientes de CTA, glows, wash de cards),
 * calculados como valores CONCRETOS a partir del acento resuelto.
 *
 * Por qué concretos y no `var(--gradient-accent)` en CSS: un custom property
 * que anida `var(--color-accent)` NO hereda el override del socio cuando se
 * usa vía var() en otro elemento (el var() anidado resuelve al valor de
 * :root, no al del scope). Verificado en runtime. En cambio, si acá metemos
 * el gradiente ya armado con el hex del acento, los componentes que hacen
 * `background: var(--gradient-accent)` heredan el valor concreto y SÍ siguen
 * la temática. Un color = todo el gradiente/glow deriva de él.
 */
export function derivedAccentVars(
  accent: string,
  accentHover: string,
  accentBorder: string,
): Record<string, string> {
  const glow = `color-mix(in srgb, ${accent} 50%, transparent)`;
  return {
    '--gradient-accent': `linear-gradient(135deg, ${accent} 0%, ${accentHover} 100%)`,
    '--gradient-accent-hover': `linear-gradient(135deg, color-mix(in srgb, ${accent} 82%, #fff) 0%, ${accent} 100%)`,
    '--color-accent-glow': glow,
    '--shadow-glow': `0 0 0 1px ${accentBorder}, 0 0 24px -4px ${glow}`,
    '--shadow-glow-strong': `0 0 22px ${glow}`,
    '--gradient-card': `linear-gradient(180deg, color-mix(in srgb, ${accent} 5%, transparent) 0%, color-mix(in srgb, ${accent} 2%, transparent) 60%, rgba(0, 0, 0, 0.12) 100%)`,
    '--gradient-card-hover': `linear-gradient(180deg, color-mix(in srgb, ${accent} 8%, transparent) 0%, color-mix(in srgb, ${accent} 3%, transparent) 60%, rgba(0, 0, 0, 0.06) 100%)`,
  };
}

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
