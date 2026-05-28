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

import { Container, Graphics, Sprite, Text, Assets, type Texture } from 'pixi.js';
import type { SymbolCode } from '@casino/games-jokers-jewels';
import { SYMBOL_SIZE } from '../core/Layout';
import { PALETTE } from '../core/Palette';
import { hasSymbolAsset } from '../core/AssetManifest';

export class SymbolSprite extends Container {
  private currentCode: SymbolCode;
  private spriteNode: Sprite | null = null;
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
    const texture = Assets.get<Texture>(`symbol.${this.currentCode}`);
    if (!texture) {
      // Asset no cargado todavía — fallback a placeholder
      this.mountPlaceholder();
      return;
    }
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    // Padding interno del 15% para que el símbolo no toque los bordes de la celda
    const padding = 0.85;
    sprite.width = SYMBOL_SIZE.WIDTH * padding;
    sprite.height = SYMBOL_SIZE.HEIGHT * padding;
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
    const radius = Math.min(SYMBOL_SIZE.WIDTH, SYMBOL_SIZE.HEIGHT) * 0.4;

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
