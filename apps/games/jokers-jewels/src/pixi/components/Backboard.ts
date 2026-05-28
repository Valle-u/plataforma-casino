/**
 * Backboard — fondo tileable del slot (la "pared" del salón).
 *
 * Sub-fase 2A.x (2026-05-27): MOVIDO al design stage para que letterboxee
 * con el resto del juego. Afuera del design stage quedan barras negras
 * automáticas (canvas backgroundColor 0x000000) cuando el aspect del
 * viewport no matchea con 16:9.
 *
 * Antes vivía a nivel app.stage cubriendo el canvas completo — eso hacía
 * que el wallpaper azul se desbordara del cabinet en aspect ratios raros.
 */

import { TilingSprite, Assets, type Texture } from 'pixi.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../core/Layout';

/**
 * Tamaño del tile del backboard en design units.
 */
const TILE_SIZE = 320;

/**
 * Crea el TilingSprite con tamaño full design space (1920×1080).
 * Al estar dentro del design stage, escala con letterbox automáticamente.
 */
export function createBackboard(): TilingSprite {
  const texture = Assets.get<Texture>('bg.backboard');
  return new TilingSprite({
    texture,
    width: DESIGN_WIDTH,
    height: DESIGN_HEIGHT,
    tileScale: { x: TILE_SIZE / texture.width, y: TILE_SIZE / texture.height },
  });
}
