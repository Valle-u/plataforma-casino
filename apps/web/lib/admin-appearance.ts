/**
 * admin-appearance — apariencia del panel de control.
 *
 * El panel admin es neutro por diseño, pero el operador puede elegir 2
 * cosas — color de acento + fondo — y de ahí se deriva el resto de la
 * paleta del panel (capas de fondo, texto, bordes, variantes de acento)
 * con el mismo motor que el sitio del jugador (`derivePalette`).
 *
 * Se guarda en el setting `admin.appearance` (independiente de la marca
 * del jugador) y se expone público en `/tenant/info` para que TODOS los
 * roles del panel lo vean aplicado, incluso los que no editan settings.
 *
 * Los colores SEMÁNTICOS (verde=entra, rojo=sale, ámbar=atención,
 * azul=info) NO se derivan: quedan fijos por la regla "un color = una
 * acción". Este motor solo toca base + acento.
 */

import {
  darken,
  derivePalette,
  lighten,
  normalizeHex,
  relLuminance,
  rgba,
} from './palette';

export interface AdminAppearance {
  /** Color de acento del panel (CTAs, ítem activo, foco). Hex #RRGGBB. */
  accent: string;
  /** Fondo base del panel. Define claro/oscuro y el tono. Hex #RRGGBB. */
  bg: string;
}

export const ADMIN_APPEARANCE_KEY = 'admin.appearance';

/** Base actual del panel (negro + gris sobrio) — el fallback sin configurar. */
export const DEFAULT_ADMIN_APPEARANCE: AdminAppearance = {
  accent: '#9aa0a8',
  bg: '#0b0b0b',
};

/** Fondos sugeridos para el panel (el operador puede elegir otro). */
export const ADMIN_BG_PRESETS: Array<{ label: string; value: string }> = [
  { label: 'Negro', value: '#0b0b0b' },
  { label: 'Grafito', value: '#131316' },
  { label: 'Noche azulada', value: '#0a0e16' },
  { label: 'Bosque', value: '#0a1210' },
  { label: 'Vino', value: '#130a0d' },
  { label: 'Claro', value: '#f4f4f7' },
];

/** Acentos sugeridos para el panel. */
export const ADMIN_ACCENT_PRESETS: Array<{ label: string; value: string }> = [
  { label: 'Gris sobrio', value: '#9aa0a8' },
  { label: 'Azul', value: '#5b8cff' },
  { label: 'Esmeralda', value: '#2fbf87' },
  { label: 'Violeta', value: '#8b5cf6' },
  { label: 'Ámbar', value: '#e0a516' },
  { label: 'Rosa', value: '#ff4d94' },
];

/**
 * Deriva el set de variables CSS `--color-*` del panel desde acento + fondo.
 * Solo base + acento (los semánticos quedan fijos en el CSS de `.admin-neutral`).
 */
export function deriveAdminVars({
  accent,
  bg,
}: AdminAppearance): Record<string, string> {
  const p = derivePalette({ accent, bg });
  const base = normalizeHex(bg);
  const darkBg = relLuminance(base) < 0.5;
  const sidebarBg = darkBg ? lighten(base, 0.02) : darken(base, 0.02);
  const bgHover = darkBg ? lighten(base, 0.04) : darken(base, 0.03);
  return {
    '--color-bg': p.bgColor,
    '--color-bg-elevated': p.bgElevated,
    '--color-bg-subtle': p.bgSubtle,
    '--color-bg-hover': bgHover,
    '--color-fg': p.fgColor,
    '--color-fg-muted': p.fgMuted,
    '--color-fg-subtle': p.fgSubtle,
    '--color-border': p.borderColor,
    '--color-border-strong': p.borderStrong,
    '--color-accent': p.accentColor,
    '--color-accent-hover': p.accentHover,
    '--color-accent-fg': p.accentFg,
    '--color-accent-text': p.accentText,
    '--color-accent-subtle': p.accentSubtle,
    '--color-accent-border': p.accentBorder,
    '--color-accent-glow': rgba(p.accentColor, 0.18),
    '--color-border-focus': rgba(p.accentColor, 0.5),
    '--sidebar-bg': sidebarBg,
  };
}

// ── Inyección en el DOM ───────────────────────────────────────────────

const STYLE_ID = 'admin-appearance-vars';

/**
 * Escribe (o borra) una regla `.admin-neutral{…}` con las variables dadas.
 * Un solo `<style>` compartido por el layout y la sección de edición, así
 * la vista previa en vivo y lo aplicado no pelean por el DOM.
 */
export function injectAdminVars(vars: Record<string, string> | null): void {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById(STYLE_ID);
  if (!vars) {
    existing?.remove();
    return;
  }
  const body = Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
  const el =
    (existing as HTMLStyleElement | null) ?? document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = `.admin-neutral{${body}}`;
  if (!existing) document.head.appendChild(el);
}

// ── Cache local (anti-flash) ──────────────────────────────────────────

const CACHE_KEY = 'admin.appearance.v1';

/** Última apariencia aplicada, para pintar el panel antes de que llegue la red. */
export function readCachedAdminAppearance(): AdminAppearance | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Record<string, unknown>;
    const isHex = (v: unknown): v is string =>
      typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
    if (isHex(p.accent) && isHex(p.bg)) return { accent: p.accent, bg: p.bg };
    return null;
  } catch {
    return null;
  }
}

export function cacheAdminAppearance(a: AdminAppearance | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (a) window.localStorage.setItem(CACHE_KEY, JSON.stringify(a));
    else window.localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}
