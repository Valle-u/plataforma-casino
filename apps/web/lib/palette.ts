/**
 * Motor de paleta del tenant.
 *
 * De pocos "knobs" (color de marca + fondo) deriva la paleta completa de
 * tokens que consume el sitio del jugador (`--color-*`). Así "Apariencia"
 * es fácil de modificar: el operador toca 2-3 colores y el resto (hover,
 * texto sobre accent, bordes, capas de fondo) sale solo, consistente y con
 * contraste razonable.
 *
 * Funciones puras y sin dependencias → testeables.
 */

/** Los 20 tokens de color que aplica el player (ver app/play/layout.tsx). */
export interface FullPalette {
  bgColor: string;
  bgElevated: string;
  bgSubtle: string;
  fgColor: string;
  fgMuted: string;
  fgSubtle: string;
  borderColor: string;
  borderStrong: string;
  accentColor: string;
  accentHover: string;
  accentFg: string;
  accentText: string;
  accentSubtle: string;
  accentBorder: string;
  success: string;
  warning: string;
  magenta: string;
  cyan: string;
  purple: string;
  gold: string;
}

export interface PaletteInput {
  /** Color de marca (hex #RRGGBB). Botones, links, highlights. */
  accent: string;
  /** Fondo base (hex #RRGGBB). Define claro/oscuro y el tono general. */
  bg: string;
  /** Overrides opcionales de los colores semánticos/decorativos. */
  semantic?: Partial<
    Pick<
      FullPalette,
      'success' | 'warning' | 'magenta' | 'cyan' | 'purple' | 'gold'
    >
  >;
}

/** Semánticos por defecto (decorativos/funcionales; rara vez se cambian). */
export const DEFAULT_SEMANTIC = {
  success: '#39d353',
  warning: '#ff7a18',
  magenta: '#ff3ec9',
  cyan: '#00e5ff',
  purple: '#9b4dff',
  gold: '#f0c46a',
} as const;

// ── Helpers de color ──────────────────────────────────────────────────

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function clamp(n: number, lo = 0, hi = 255): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Normaliza a #rrggbb en minúsculas. Acepta #rgb y #rrggbb. */
export function normalizeHex(hex: string): string {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return '#000000';
  return '#' + h.toLowerCase();
}

export function hexToRgb(hex: string): Rgb {
  const h = normalizeHex(hex).slice(1);
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }: Rgb): string {
  const to = (n: number) => clamp(Math.round(n)).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** Mezcla lineal de dos hex. t=0 → a, t=1 → b. */
export function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const k = Math.min(1, Math.max(0, t));
  return rgbToHex({
    r: ca.r + (cb.r - ca.r) * k,
    g: ca.g + (cb.g - ca.g) * k,
    b: ca.b + (cb.b - ca.b) * k,
  });
}

const WHITE = '#ffffff';
const BLACK = '#000000';

export function lighten(hex: string, amount: number): string {
  return mix(hex, WHITE, amount);
}
export function darken(hex: string, amount: number): string {
  return mix(hex, BLACK, amount);
}

/** rgba(...) a partir de un hex + alpha. */
export function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 1000) / 1000;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Luminancia relativa WCAG (0 = negro, 1 = blanco). */
export function relLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const chan = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

/** Negro o blanco, el que mejor contraste tenga sobre `bg`. */
export function contrastText(bg: string): string {
  return relLuminance(bg) > 0.45 ? '#0b0b0d' : '#ffffff';
}

// ── Derivación de la paleta completa ───────────────────────────────────

/**
 * Deriva los 20 tokens desde el color de marca + el fondo. La lógica se
 * adapta a fondos claros u oscuros (mide luminancia), así funciona con
 * cualquier base.
 */
export function derivePalette(input: PaletteInput): FullPalette {
  const bg = normalizeHex(input.bg);
  const accent = normalizeHex(input.accent);
  const darkBg = relLuminance(bg) < 0.5;

  // Fondos: capas cada vez más claras (oscuras si el fondo es claro).
  const bgElevated = darkBg ? lighten(bg, 0.05) : darken(bg, 0.04);
  const bgSubtle = darkBg ? lighten(bg, 0.1) : darken(bg, 0.08);

  // Texto: near-blanco sobre fondo oscuro (o near-negro sobre claro), con
  // un toque del accent para que "combine".
  const baseText = darkBg ? '#fafafa' : '#0b0b0d';
  const fgColor = mix(baseText, accent, 0.03);
  const fgMuted = mix(fgColor, bg, 0.35);
  const fgSubtle = mix(fgColor, bg, 0.55);

  // Bordes: derivados del texto con baja opacidad (neutros, no ruidosos).
  const borderColor = rgba(fgColor, 0.1);
  const borderStrong = rgba(fgColor, 0.2);

  // Accent: variantes derivadas del color de marca.
  const accentHover = darken(accent, 0.08);
  const accentFg = contrastText(accent);
  const la = relLuminance(accent);
  // accentText tiene que leerse sobre el fondo: si el accent es muy oscuro
  // en un fondo oscuro (o muy claro en uno claro), se ajusta.
  let accentText = accent;
  if (darkBg && la < 0.3) accentText = lighten(accent, 0.4);
  else if (!darkBg && la > 0.6) accentText = darken(accent, 0.4);
  const accentSubtle = rgba(accent, 0.12);
  const accentBorder = rgba(accent, 0.4);

  const semantic = { ...DEFAULT_SEMANTIC, ...input.semantic };

  return {
    bgColor: bg,
    bgElevated,
    bgSubtle,
    fgColor,
    fgMuted,
    fgSubtle,
    borderColor,
    borderStrong,
    accentColor: accent,
    accentHover,
    accentFg,
    accentText,
    accentSubtle,
    accentBorder,
    success: semantic.success,
    warning: semantic.warning,
    magenta: semantic.magenta,
    cyan: semantic.cyan,
    purple: semantic.purple,
    gold: semantic.gold,
  };
}
