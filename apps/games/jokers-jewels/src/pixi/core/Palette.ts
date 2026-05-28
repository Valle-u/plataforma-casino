/**
 * Palette — colores del slot en formato Pixi (number hex 0xRRGGBB).
 *
 * Centralizar acá los colores hace que sea fácil tunear la paleta sin
 * tocar componentes. Mirror de los CSS custom properties del legacy.
 */

export const PALETTE = {
  // Backgrounds
  BG_DEEPEST: 0x1a0a2e,
  BG_DEEP: 0x2d1547,
  BG_BASE: 0x4a2080,
  BG_LIGHT: 0x6b2fa8,
  BG_REEL: 0x5a2696,
  BG_REEL_DEEP: 0x3a1568,

  // Acentos
  GOLD: 0xffd700,
  GOLD_BRIGHT: 0xffec5c,
  GOLD_DARK: 0xb8860b,
  ORANGE: 0xff8c2e,
  RED: 0xe91e63,
  PINK: 0xec4899,
  CYAN: 0x4dd0e1,
  BLUE: 0x2563eb,
  RUBY: 0xdc2626,
  GREEN: 0x16a34a,

  // Texto
  WHITE: 0xffffff,
  CREAM: 0xfff5e6,

  // Symbol fallback colors (cuando no hay asset)
  SYMBOL_FALLBACK: {
    joker: 0xe91e63,
    crown: 0xffd700,
    mandolin: 0xb8860b,
    boots: 0xec4899,
    bolos: 0xfff5e6,
    ruby: 0xdc2626,
    sapphire: 0x4dd0e1,
    emerald: 0x16a34a,
  },
} as const;
