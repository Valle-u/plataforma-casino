/**
 * Colores del tenant → variables CSS.
 *
 * Función pura, sin `document` ni hooks: la usan **el servidor y el cliente**.
 * Esa es la razón de que exista como archivo aparte.
 *
 * El mapeo vivía suelto dentro de `app/play/layout.tsx`. Al pasar a pintar los
 * colores también desde el servidor haría falta el mismo mapeo en dos lugares,
 * y dos copias de una tabla de 20 claves se desincronizan: alguien agrega un
 * color en el panel, lo mapea en un lado y en el otro no, y el color aparece
 * recién después de hidratar. Es decir, vuelve el parpadeo, pero sólo para ese
 * color y sin que nadie entienda por qué.
 */

import { derivedAccentVars } from './player-appearance';

/**
 * Cómo se llama cada color en la configuración del tenant y en qué variable CSS
 * termina. El nombre de la izquierda es el que guarda el panel en
 * `design.config.colors`.
 */
const MAPA_DE_COLORES: Record<string, string> = {
  bgColor: '--color-bg',
  bgElevated: '--color-bg-elevated',
  bgSubtle: '--color-bg-subtle',
  fgColor: '--color-fg',
  fgMuted: '--color-fg-muted',
  fgSubtle: '--color-fg-subtle',
  borderColor: '--color-border',
  borderStrong: '--color-border-strong',
  accentColor: '--color-accent',
  accentHover: '--color-accent-hover',
  accentFg: '--color-accent-fg',
  accentText: '--color-accent-text',
  accentSubtle: '--color-accent-subtle',
  accentBorder: '--color-accent-border',
  success: '--color-success',
  warning: '--color-warning',
  magenta: '--color-magenta',
  cyan: '--color-cyan',
  purple: '--color-purple',
  gold: '--color-gold',
};

/** Acento del sistema de diseño, cuando el tenant no configuró ninguno. */
export const ACENTO_POR_DEFECTO = '#ff2ea0';
const ACENTO_HOVER_POR_DEFECTO = '#e0208a';
const ACENTO_BORDE_POR_DEFECTO = 'rgba(255, 46, 160, 0.4)';

/**
 * Variables CSS de la paleta del jugador.
 *
 * `colores` viene de `design.config.colors` y se lee **defensivo**: es jsonb
 * libre editado desde el panel, así que puede traer claves que no existen o
 * valores que no son strings. Lo que no se reconoce se ignora en vez de
 * romper el render.
 *
 * @param base variables previas (las del tema claro/oscuro). Los colores del
 *   tenant las pisan; lo que el tenant no definió, se conserva.
 */
export function variablesDeColorDelTenant(
  colores: unknown,
  colorDeMarca: string | null | undefined,
  base: Record<string, string> = {},
): Record<string, string> {
  const vars: Record<string, string> = { ...base };

  if (colores && typeof colores === 'object') {
    const dict = colores as Record<string, unknown>;
    for (const [clave, cssVar] of Object.entries(MAPA_DE_COLORES)) {
      const valor = dict[clave];
      if (typeof valor === 'string' && valor.trim()) vars[cssVar] = valor;
    }
  }

  // El color de marca le gana al acento de la paleta: es el que el operador
  // configura en Marca, más arriba en la jerarquía.
  if (colorDeMarca) vars['--color-accent'] = colorDeMarca;

  // Degradados y brillos como valores CONCRETOS: un `var()` anidado no hereda
  // el override fuera de `:root`. Ver `derivedAccentVars`.
  Object.assign(
    vars,
    derivedAccentVars(
      vars['--color-accent'] ?? ACENTO_POR_DEFECTO,
      vars['--color-accent-hover'] ?? vars['--color-accent'] ?? ACENTO_HOVER_POR_DEFECTO,
      vars['--color-accent-border'] ?? ACENTO_BORDE_POR_DEFECTO,
    ),
  );

  return vars;
}

/**
 * Serializa variables a un bloque CSS listo para un `<style>`.
 *
 * **Filtra los valores con `<`, `>` o `;`.** Estos colores salen de un campo de
 * texto del panel y terminan dentro de una etiqueta `<style>` del HTML: sin
 * filtrar, un operador podría cerrar la etiqueta y escribir markup en la página
 * de todos sus jugadores. Un color legítimo nunca lleva esos caracteres.
 */
export function bloqueCssDeVariables(
  vars: Record<string, string>,
  selector = ':root',
): string {
  const limpias = Object.entries(vars).filter(
    ([clave, valor]) =>
      /^--[a-z0-9-]+$/i.test(clave) && !/[<>;{}]/.test(valor),
  );
  if (limpias.length === 0) return '';
  const cuerpo = limpias.map(([k, v]) => `${k}:${v}`).join(';');
  return `${selector}{${cuerpo}}`;
}
