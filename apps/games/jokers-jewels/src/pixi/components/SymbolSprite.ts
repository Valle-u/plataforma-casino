/**
 * SymbolSprite — wrapper visual de un símbolo del reel.
 *
 * Si el SymbolCode tiene asset cargado → se renderiza el sprite real
 * (joker.webp, emerald.webp, etc).
 * Si no tiene asset → se dibuja un placeholder con PIXI.Graphics
 * (círculo coloreado + label con la inicial).
 *
 * Cada SymbolSprite es un Container con:
 *   - position.set(x, y) → posiciona en su celda del reel
 *   - setSymbol(code)    → cambia el símbolo que muestra (reuso)
 *   - setGlowing(bool)   → highlight para celdas ganadoras
 *
 * Diseñado para ser reusado entre frames del spin (pool pattern) en
 * lugar de crear/destruir sprites en cada vuelta.
 */

import { Container, Graphics, Sprite, Text, Assets, BlurFilter, Rectangle, Texture } from 'pixi.js';
import type { SymbolCode } from '@casino/games-jokers-jewels';
import { SYMBOL_SIZE } from '../core/Layout';
import { PALETTE } from '../core/Palette';
import { hasSymbolAsset } from '../core/AssetManifest';

/**
 * Fracción de la celda que ocupa el símbolo. >1 hace que el símbolo
 * sobresalga un poco de su celda (como en el original Pragmatic, donde
 * las fichas son grandes y casi se tocan entre filas). El factor aplica
 * sobre el lado más limitante (la altura, porque la celda es ancha-baja).
 */
const SYMBOL_FILL = 0.95;
/** Drop shadow — offset y opacidad de la sombra detrás del símbolo. */
const SHADOW_OFFSET_X = 5;
const SHADOW_OFFSET_Y = 8;
const SHADOW_ALPHA = 0.38;
const SHADOW_BLUR = 4;
/** Alpha mínimo (0-255) para considerar un pixel como "contenido" al recortar. */
const TRIM_ALPHA_THRESHOLD = 12;

/**
 * Caché de texturas ya recortadas (una por symbol code). Las texturas son
 * compartidas y nunca se destruyen durante el juego, así que cachearlas
 * evita re-escanear los pixeles en cada render/reuso.
 */
const trimmedTexCache = new Map<string, Texture>();

/**
 * Devuelve una sub-textura que recorta el padding transparente alrededor
 * del dibujo. Esto NORMALIZA assets exportados de forma inconsistente:
 * un símbolo con mucho aire (512×512 con el dibujo flotando) y uno pegado
 * al borde (241×213) terminan con su contenido visible ocupando el mismo
 * box → todos los símbolos se ven del mismo tamaño.
 *
 * Escanea el alpha una sola vez por code y cachea el resultado.
 */
function getTrimmedTexture(code: string, base: Texture): Texture {
  const cached = trimmedTexCache.get(code);
  if (cached) return cached;

  const source = base.source;
  const w = source.width;
  const h = source.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    trimmedTexCache.set(code, base);
    return base;
  }

  ctx.drawImage(source.resource as CanvasImageSource, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if ((data[(y * w + x) * 4 + 3] ?? 0) > TRIM_ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  // Textura totalmente transparente — no hay nada que recortar.
  if (maxX < minX) {
    trimmedTexCache.set(code, base);
    return base;
  }

  const frame = new Rectangle(minX, minY, maxX - minX + 1, maxY - minY + 1);
  const trimmed = new Texture({ source, frame });
  trimmedTexCache.set(code, trimmed);
  return trimmed;
}

export class SymbolSprite extends Container {
  private currentCode: SymbolCode;
  private spriteNode: Sprite | null = null;
  private shadowNode: Sprite | null = null;
  private placeholderNode: Container | null = null;
  private glowing = false;

  constructor(code: SymbolCode) {
    super();
    this.currentCode = code;
    this.render();
  }

  /**
   * Cambia el símbolo que muestra este sprite (sin destruir el Container).
   * Si el código es el mismo que ya muestra, no hace nada.
   */
  setSymbol(code: SymbolCode): void {
    if (code === this.currentCode) return;
    this.currentCode = code;
    this.render();
  }

  /**
   * Toggle del glow (highlight de celdas ganadoras).
   * Sub-fase futura: reemplazar por filter de glow real (PIXI Filter).
   */
  setGlowing(glowing: boolean): void {
    if (this.glowing === glowing) return;
    this.glowing = glowing;
    this.alpha = glowing ? 1.0 : 1.0;
    this.scale.set(glowing ? 1.05 : 1.0);
  }

  /**
   * Re-renderiza los children del Container según `currentCode`.
   * Limpia los nodes previos y monta el nuevo.
   */
  private render(): void {
    // Limpiar children previos
    if (this.shadowNode) {
      this.removeChild(this.shadowNode);
      this.shadowNode.destroy();
      this.shadowNode = null;
    }
    if (this.spriteNode) {
      this.removeChild(this.spriteNode);
      this.spriteNode.destroy();
      this.spriteNode = null;
    }
    if (this.placeholderNode) {
      this.removeChild(this.placeholderNode);
      this.placeholderNode.destroy({ children: true });
      this.placeholderNode = null;
    }

    if (hasSymbolAsset(this.currentCode)) {
      this.mountSprite();
    } else {
      this.mountPlaceholder();
    }
  }

  /**
   * Monta el Sprite real cargado del AssetManager.
   * Centrado en (0,0) y escalado a SYMBOL_SIZE.
   */
  private mountSprite(): void {
    const base = Assets.get<Texture>(`symbol.${this.currentCode}`);
    if (!base) {
      // Asset no cargado todavía — fallback a placeholder
      this.mountPlaceholder();
      return;
    }
    // Recorta el padding transparente para que TODOS los símbolos se vean
    // del mismo tamaño, sin importar cuánto aire tenga cada asset fuente.
    const texture = getTrimmedTexture(this.currentCode, base);
    // Fit "contain": escala uniforme para preservar el aspect ratio del
    // símbolo dentro de la celda (que NO es cuadrada — es más ancha que
    // alta). Escalar width/height por separado deformaría la imagen.
    const maxW = SYMBOL_SIZE.WIDTH * SYMBOL_FILL;
    const maxH = SYMBOL_SIZE.HEIGHT * SYMBOL_FILL;
    const scale = Math.min(maxW / texture.width, maxH / texture.height);

    // Drop shadow: copia tinteada de negro, offset y desenfocada, detrás
    // del símbolo. Hace que el símbolo "flote" sobre el fondo violeta.
    const shadow = new Sprite(texture);
    shadow.anchor.set(0.5);
    shadow.scale.set(scale);
    shadow.position.set(SHADOW_OFFSET_X, SHADOW_OFFSET_Y);
    shadow.tint = 0x000000;
    shadow.alpha = SHADOW_ALPHA;
    shadow.filters = [new BlurFilter({ strength: SHADOW_BLUR })];
    this.shadowNode = shadow;
    this.addChild(shadow);

    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.scale.set(scale);
    this.spriteNode = sprite;
    this.addChild(sprite);
  }

  /**
   * Placeholder cuando no hay asset: círculo coloreado + label con
   * las primeras 2 letras del symbol code.
   */
  private mountPlaceholder(): void {
    const container = new Container();
    const color = PALETTE.SYMBOL_FALLBACK[this.currentCode] ?? PALETTE.WHITE;
    // Mismo footprint que los símbolos reales (limitados por la altura de
    // la celda × SYMBOL_FILL) para que placeholders y assets se vean iguales.
    const radius = (SYMBOL_SIZE.HEIGHT * SYMBOL_FILL) / 2;

    const circle = new Graphics()
      .circle(0, 0, radius)
      .fill({ color, alpha: 0.9 })
      .stroke({ width: 4, color: PALETTE.WHITE, alpha: 0.6 });
    container.addChild(circle);

    const label = new Text({
      text: this.currentCode.slice(0, 3).toUpperCase(),
      style: {
        fill: PALETTE.WHITE,
        fontSize: 36,
        fontFamily: 'Fredoka, system-ui, sans-serif',
        fontWeight: '700',
        stroke: { color: 0x000000, width: 3 },
        align: 'center',
      },
    });
    label.anchor.set(0.5);
    container.addChild(label);

    this.placeholderNode = container;
    this.addChild(container);
  }
}
