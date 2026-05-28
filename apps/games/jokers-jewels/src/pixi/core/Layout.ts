/**
 * Layout — constantes de geometría del slot.
 *
 * Sub-fase 2A.x PixiJS (2026-05-27): pivot a TEMPLATE-DRIVEN.
 *
 * El cabinet (paytable + columnas + chrome + base) viene en UN solo
 * asset `template.webp` (1674×940 px) extraído del original Pragmatic
 * con Photopea, con el centro transparente donde van los reels.
 *
 * Los reels PixiJS se posicionan EXACTO en el agujero transparente.
 * Las coordenadas del hole se mapean del image-space (1674×940) al
 * design-space (1920×1080) — aspect ratios casi idénticos (1.78 vs 1.78).
 *
 * Hole en image space (detectado por scan de pixels alfa):
 *   x=150 → x=1522 (width 1372)
 *   y=302 → y=814 (height 512)
 *
 * Convertido a design space (1920/1674 ≈ 1.147x, 1080/940 ≈ 1.149x):
 *   x=172 → x=1746 (width 1574)
 *   y=347 → y=935 (height 588)
 */

export const DESIGN_WIDTH = 1920;
export const DESIGN_HEIGHT = 1080;
export const DESIGN_ASPECT = DESIGN_WIDTH / DESIGN_HEIGHT;

/**
 * Reels — los 5×3 reels. Posición y dimensiones derivadas del hole
 * transparente del template.webp.
 */
export const REELS = {
  COLS: 5,
  ROWS: 3,
  /** Ancho total del área de reels = hole width en design space. */
  WIDTH: 1574,
  /** Alto total del área de reels = hole height en design space. */
  HEIGHT: 588,
  /** Centro X (medio del hole horizontal). */
  CENTER_X: 959,
  /** Centro Y (medio del hole vertical). */
  CENTER_Y: 641,
} as const;

/** Tamaño de cada celda (símbolo) — derivado de REELS. */
export const SYMBOL_SIZE = {
  WIDTH: REELS.WIDTH / REELS.COLS,   // 314.8
  HEIGHT: REELS.HEIGHT / REELS.ROWS, // 196
} as const;

/** Spin animation — durations y staggers. */
export const SPIN = {
  BASE_DURATION_MS: 600,
  STAGGER_MS: 130,
  SYMBOL_CYCLES: 12,
  MAX_VELOCITY: 4500,
} as const;
