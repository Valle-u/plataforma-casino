/**
 * admin-accent — deriva el set completo de variables de acento del panel a
 * partir del color de marca del tenant (branding.primaryColor).
 *
 * El panel admin es neutro (negro/gris) salvo el ACENTO, que sale del color de
 * marca de cada casino. Este helper calcula lo que el color solo no da:
 *   - el texto sobre el botón (negro o blanco, según el brillo del color, para
 *     que SIEMPRE se lea),
 *   - un hover levemente desplazado,
 *   - una versión legible del acento como texto sobre el fondo casi-negro
 *     (si el color es muy oscuro, se aclara),
 *   - las variantes translúcidas (chips, bordes, foco).
 *
 * Si no hay color de marca, el panel usa el fallback gris medio de `.admin-neutral`.
 */

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseHex(hex: string): Rgb | null {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function toHex({ r, g, b }: Rgb): string {
  const c = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Luminancia relativa WCAG (0 = negro, 1 = blanco). */
function luminance({ r, g, b }: Rgb): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

const BLACK: Rgb = { r: 0, g: 0, b: 0 };
const WHITE: Rgb = { r: 255, g: 255, b: 255 };

/**
 * Devuelve el mapa de variables CSS del acento para un color de marca, o
 * `null` si el hex es inválido (→ el panel cae al fallback gris del CSS).
 */
export function adminAccentVars(hex: string): Record<string, string> | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const L = luminance(rgb);
  const light = L > 0.4;
  // Texto sobre el botón: negro si el acento es claro, blanco si es oscuro.
  const fg = light ? '#16181b' : '#ffffff';
  // Hover: desplazar levemente hacia el color de texto (feedback sutil).
  const hover = toHex(light ? mix(rgb, BLACK, 0.1) : mix(rgb, WHITE, 0.12));
  // Acento como TEXTO sobre fondo casi-negro (links, item activo): si es muy
  // oscuro, aclararlo para que se lea.
  const text = L < 0.12 ? toHex(mix(rgb, WHITE, 0.45)) : toHex(rgb);
  const { r, g, b } = rgb;
  const rgba = (a: number) => `rgba(${r}, ${g}, ${b}, ${a})`;
  return {
    '--color-accent': toHex(rgb),
    '--color-accent-hover': hover,
    '--color-accent-fg': fg,
    '--color-accent-text': text,
    '--color-accent-subtle': rgba(0.12),
    '--color-accent-border': rgba(0.3),
    '--color-accent-glow': rgba(0.18),
    '--color-border-focus': rgba(0.5),
  };
}
