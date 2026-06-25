/**
 * useTheme / themes — Sprint 51.29.
 *
 * Permite al player elegir un esquema de accent color entre 4 presets
 * (Crimson default, Royal Gold, Sapphire, Emerald). El override se
 * aplica como `style` inline en el wrapper de `/play/layout.tsx` (no
 * pisa el branding del tenant — si el tenant define accent vía
 * `useTenantInfo().branding.primaryColor`, ese sigue ganando).
 *
 * Persistencia: localStorage `casino:theme`.
 *
 * Filosofía: el theme afecta SOLO los `--color-accent*` vars. Bg, fg,
 * borders, success/warning quedan igual. La idea es darle al player una
 * pizca de personalización sin romper la consistencia del DS.
 *
 * IMPORTANTE: este theme solo aplica a /play. El admin tiene su look
 * propio y NO debe ser configurable por el player.
 */

'use client';

import { useEffect, useState, type CSSProperties } from 'react';

export type ThemeId = 'tango' | 'gold' | 'sapphire' | 'emerald' | 'crimson';

export interface ThemeDef {
  id: ThemeId;
  label: string;
  swatch: string; // color de muestra para el picker
  vars: {
    accent: string;
    accentHover: string;
    accentFg: string;
    accentText: string;
    accentSubtle: string;
    accentBorder: string;
    accentGlow: string;
  };
}

/**
 * Los themes están definidos de tal forma que mantienen contrast ratios
 * WCAG AA. `accentText` siempre es lo bastante claro para verse sobre
 * `bg-base`, y `accent` siempre tiene contraste suficiente con `accentFg`
 * para textos en CTAs.
 */
export const THEMES: Record<ThemeId, ThemeDef> = {
  // Casino TANGO — Neón Milonga. Azul eléctrico + cian neón. Default.
  // Sus valores coinciden EXACTO con los tokens globales del DS para que
  // /play se vea igual que el resto de la marca.
  tango: {
    id: 'tango',
    label: 'Tango',
    swatch: '#2e9bff',
    vars: {
      accent: '#2e9bff',
      accentHover: '#1f6fff',
      accentFg: '#04060e',
      accentText: '#57e6ff',
      accentSubtle: 'rgba(46, 155, 255, 0.12)',
      accentBorder: 'rgba(87, 230, 255, 0.4)',
      accentGlow: 'rgba(46, 155, 255, 0.5)',
    },
  },
  crimson: {
    id: 'crimson',
    label: 'Carmesí',
    swatch: '#dc2626',
    vars: {
      accent: '#dc2626',
      accentHover: '#b91c1c',
      accentFg: '#ffffff',
      accentText: '#f87171',
      accentSubtle: '#2a0e0e',
      accentBorder: '#7f1d1d',
      accentGlow: 'rgba(220, 38, 38, 0.18)',
    },
  },
  gold: {
    id: 'gold',
    label: 'Dorado real',
    swatch: '#FFD700',
    vars: {
      accent: '#d4a017',
      accentHover: '#b88812',
      accentFg: '#1a0f00',
      accentText: '#FFD700',
      accentSubtle: '#2a1f04',
      accentBorder: '#7a5b0e',
      accentGlow: 'rgba(255, 215, 0, 0.22)',
    },
  },
  sapphire: {
    id: 'sapphire',
    label: 'Zafiro',
    swatch: '#4F9BFF',
    vars: {
      accent: '#3b82f6',
      accentHover: '#2563eb',
      accentFg: '#ffffff',
      accentText: '#60a5fa',
      accentSubtle: '#0c1f3d',
      accentBorder: '#1d3a73',
      accentGlow: 'rgba(59, 130, 246, 0.22)',
    },
  },
  emerald: {
    id: 'emerald',
    label: 'Esmeralda',
    swatch: '#22c55e',
    vars: {
      accent: '#16a34a',
      accentHover: '#15803d',
      accentFg: '#ffffff',
      accentText: '#4ade80',
      accentSubtle: '#0a2818',
      accentBorder: '#14532d',
      accentGlow: 'rgba(34, 197, 94, 0.22)',
    },
  },
};

const STORAGE_KEY = 'casino:theme';
const DEFAULT_THEME: ThemeId = 'tango';

export function useTheme(): {
  theme: ThemeId;
  setTheme: (next: ThemeId) => void;
} {
  const [theme, setThemeState] = useState<ThemeId>(DEFAULT_THEME);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored && stored in THEMES) {
        setThemeState(stored as ThemeId);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const setTheme = (next: ThemeId) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    // Notify other components in the same tab via custom event (storage
    // event no se dispara en la misma tab).
    window.dispatchEvent(new Event('casino:theme-changed'));
  };

  // Escuchar cambios desde otros componentes (multi-tab + same-tab).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const reload = () => {
      try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (stored && stored in THEMES) setThemeState(stored as ThemeId);
        else setThemeState(DEFAULT_THEME);
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('storage', reload);
    window.addEventListener('casino:theme-changed', reload);
    return () => {
      window.removeEventListener('storage', reload);
      window.removeEventListener('casino:theme-changed', reload);
    };
  }, []);

  return { theme, setTheme };
}

/**
 * Construye el `style` que sobreescribe los CSS vars del accent. Llamar
 * desde el wrapper de layout y pasarlo via `style={...}`.
 *
 * Si querés combinar con otro override (e.g. tenant branding), spread
 * éste primero y después el del tenant para que el tenant gane (esa
 * regla es importante: branding del tenant > preferencia del player).
 */
export function themeToStyle(themeId: ThemeId): CSSProperties {
  const t = THEMES[themeId];
  return {
    ['--color-accent' as string]: t.vars.accent,
    ['--color-accent-hover' as string]: t.vars.accentHover,
    ['--color-accent-fg' as string]: t.vars.accentFg,
    ['--color-accent-text' as string]: t.vars.accentText,
    ['--color-accent-subtle' as string]: t.vars.accentSubtle,
    ['--color-accent-border' as string]: t.vars.accentBorder,
    ['--color-accent-glow' as string]: t.vars.accentGlow,
  };
}
