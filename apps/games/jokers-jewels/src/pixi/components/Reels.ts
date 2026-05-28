/**
 * Reels — contenedor de los 5 reels del slot.
 *
 * Layers de back a front (z-order):
 *   1. Background base (violet sólido)
 *   2. Quilted texture overlay (rombos sutiles — patrón del original)
 *   3. Reel containers (5 columnas con sus símbolos)
 *   4. Cylindrical vignette overlay (oscurece top y bottom — efecto 3D)
 *   5. Reel separators (líneas verticales sutiles entre columnas)
 *
 * El vignette y la textura quilted le dan al área de reels el look
 * "cilindro rotante" del original Pragmatic en vez del rect 2D plano.
 */

import { Container, Graphics, Sprite, TilingSprite, Texture } from 'pixi.js';
import type { Board } from '@casino/games-jokers-jewels';
import { Reel } from './Reel';
import { REELS, SYMBOL_SIZE } from '../core/Layout';
import { PALETTE } from '../core/Palette';

/**
 * Genera la textura del patrón quilted (rombos) — un solo tile tileable.
 * Tile de 50×50 con un diamante centrado, fill semi-transparente y borde
 * oscuro. Al tilearse forma el patrón del cabinet del original.
 */
function createQuiltedTexture(): Texture {
  const SIZE = 50;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context no disponible');

  // Diamante central — fill apenas más claro que el fondo
  ctx.fillStyle = 'rgba(255, 255, 255, 0.045)';
  ctx.beginPath();
  ctx.moveTo(SIZE / 2, 2);
  ctx.lineTo(SIZE - 2, SIZE / 2);
  ctx.lineTo(SIZE / 2, SIZE - 2);
  ctx.lineTo(2, SIZE / 2);
  ctx.closePath();
  ctx.fill();

  // Outline oscuro — el "surco" entre rombos
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.lineWidth = 1;
  ctx.stroke();

  return Texture.from(canvas);
}

/**
 * Genera la textura del vignette cilíndrico — un gradient vertical
 * (1px wide × 256px tall) que se estira horizontalmente.
 * Top oscuro → centro transparent → bottom oscuro.
 * Esto simula la curvatura del reel cilíndrico.
 */
function createCylindricalVignetteTexture(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context no disponible');

  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0.0,  'rgba(0, 0, 0, 0.55)');   // top — sombra fuerte
  g.addColorStop(0.12, 'rgba(0, 0, 0, 0.25)');
  g.addColorStop(0.25, 'rgba(0, 0, 0, 0.05)');
  g.addColorStop(0.5,  'rgba(0, 0, 0, 0)');       // centro — sin oscurecer
  g.addColorStop(0.75, 'rgba(0, 0, 0, 0.05)');
  g.addColorStop(0.88, 'rgba(0, 0, 0, 0.25)');
  g.addColorStop(1.0,  'rgba(0, 0, 0, 0.55)');   // bottom — sombra fuerte

  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1, 256);

  return Texture.from(canvas);
}

/**
 * Genera un highlight horizontal sutil para sugerir reflejo de luz
 * sobre el "cilindro" — una banda clara en el medio que va de
 * transparente a clara a transparente.
 */
function createCenterHighlightTexture(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context no disponible');

  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0,    'rgba(255, 255, 255, 0)');
  g.addColorStop(0.42, 'rgba(255, 255, 255, 0)');
  g.addColorStop(0.5,  'rgba(255, 255, 255, 0.08)'); // sutil reflejo de luz
  g.addColorStop(0.58, 'rgba(255, 255, 255, 0)');
  g.addColorStop(1,    'rgba(255, 255, 255, 0)');

  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1, 256);

  return Texture.from(canvas);
}

export class Reels extends Container {
  private reels: Reel[] = [];

  constructor(initialBoard: Board) {
    super();

    // ── 1. Background base ──────────────────────────────────────────
    const bg = new Graphics()
      .rect(0, 0, REELS.WIDTH, REELS.HEIGHT)
      .fill({ color: PALETTE.BG_REEL });
    this.addChild(bg);

    // ── 2. Quilted texture overlay ──────────────────────────────────
    const quiltedTex = createQuiltedTexture();
    const quiltedTile = new TilingSprite({
      texture: quiltedTex,
      width: REELS.WIDTH,
      height: REELS.HEIGHT,
    });
    quiltedTile.alpha = 0.85;
    this.addChild(quiltedTile);

    // ── 3. Reels (5 columnas con símbolos) ──────────────────────────
    for (let col = 0; col < REELS.COLS; col++) {
      const columnSymbols = initialBoard[col] ?? [];
      const reel = new Reel(col, [...columnSymbols]);
      reel.position.set(col * SYMBOL_SIZE.WIDTH, 0);
      this.reels.push(reel);
      this.addChild(reel);
    }

    // ── 4. Cylindrical vignette (oscurece top/bottom) ──────────────
    const vignetteTex = createCylindricalVignetteTexture();
    const vignette = new Sprite(vignetteTex);
    vignette.width = REELS.WIDTH;
    vignette.height = REELS.HEIGHT;
    this.addChild(vignette);

    // ── 4b. Center highlight (reflejo de luz sutil en el medio) ────
    const highlightTex = createCenterHighlightTexture();
    const highlight = new Sprite(highlightTex);
    highlight.width = REELS.WIDTH;
    highlight.height = REELS.HEIGHT;
    highlight.blendMode = 'add';
    this.addChild(highlight);

    // ── 5. Reel separators (líneas verticales sutiles) ──────────────
    for (let col = 1; col < REELS.COLS; col++) {
      const sep = new Graphics()
        .rect(col * SYMBOL_SIZE.WIDTH - 1, 0, 2, REELS.HEIGHT)
        .fill({ color: PALETTE.BG_REEL_DEEP, alpha: 0.6 });
      this.addChild(sep);
    }
  }

  /**
   * Arranca el spin de los 5 reels. Resuelve cuando TODOS pararon.
   */
  async spin(finalBoard: Board): Promise<void> {
    await Promise.all(
      this.reels.map((reel, col) => reel.spin([...(finalBoard[col] ?? [])])),
    );
  }
}
