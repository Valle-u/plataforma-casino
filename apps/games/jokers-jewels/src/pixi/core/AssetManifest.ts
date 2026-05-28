/**
 * Asset manifest — mapeo central de assets que el slot necesita.
 *
 * Los paths apuntan a `public/assets/` (servidos por Vite en `/assets/...`).
 * Centralizar acá permite que el AssetLoader pueda precargar TODO en
 * paralelo antes de mostrar la escena.
 *
 * Convención de keys:
 *   - bg.*       → fondos
 *   - frame.*    → cabinet (columnas, base, etc.)
 *   - symbol.*   → símbolos del paytable (8 totales)
 */

import type { SymbolCode } from '@casino/games-jokers-jewels';

export interface AssetEntry {
  /** Key único para acceder a la textura cargada. */
  readonly key: string;
  /** Path relativo a `public/`. */
  readonly url: string;
}

/**
 * Símbolos que TIENEN un asset WebP listo. El resto cae a placeholder
 * generado proceduralmente (PIXI.Graphics) hasta que se generen.
 */
const SYMBOLS_WITH_ASSET: ReadonlySet<SymbolCode> = new Set(['joker', 'emerald', 'bolos']);

export const ASSETS: readonly AssetEntry[] = [
  // ─── Backgrounds ────────────────────────────────────────────────────
  { key: 'bg.backboard', url: '/assets/backboard.webp' },

  // ─── Cabinet / Frame ────────────────────────────────────────────────
  // Sub-fase 2A.x: el cabinet entero (paytable + columnas + base + chrome)
  // viene en UN solo asset PNG con el centro transparente (donde van los
  // reels). Cero código procedural — todo el aesthetic es del original.
  { key: 'frame.template', url: '/assets/template.webp' },

  // ─── Reel strip ─────────────────────────────────────────────────────
  // Textura del fondo de UNA columna de reel (patrón quilted + bordes
  // dorados + gloss del cilindro). Se tilea verticalmente y scrollea
  // durante el spin. Reemplaza el fondo procedural de los reels.
  { key: 'reel.strip', url: '/assets/reel-strip.webp' },

  // ─── Symbols (solo los que tienen asset; resto = placeholder) ───────
  ...Array.from(SYMBOLS_WITH_ASSET).map((code) => ({
    key: `symbol.${code}`,
    url: `/assets/symbols/${code}.webp`,
  })),
];

export function hasSymbolAsset(code: SymbolCode): boolean {
  return SYMBOLS_WITH_ASSET.has(code);
}
