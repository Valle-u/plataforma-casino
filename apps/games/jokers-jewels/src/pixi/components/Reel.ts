/**
 * Reel — UNA columna de símbolos del slot.
 *
 * Internamente mantiene una "tira" de SymbolSprite que se mueve
 * verticalmente durante el spin. Cuando un sprite sale por abajo
 * del área visible, se reposiciona arriba (lazy wrap) con un nuevo
 * símbolo aleatorio. Cuando el reel debe parar, se enclaba a las
 * posiciones finales (las que vienen del backend / math package).
 *
 * Tweens via GSAP — usamos un timeline para spin + bounce stop.
 */

import { Container, Graphics, BlurFilter } from 'pixi.js';
import gsap from 'gsap';
import type { SymbolCode } from '@casino/games-jokers-jewels';
import { SymbolSprite } from './SymbolSprite';
import { SYMBOL_SIZE, REELS, SPIN } from '../core/Layout';

/** Strength máximo del motion blur VERTICAL durante el spin a máxima velocidad. */
const MAX_BLUR_STRENGTH_Y = 28;

/**
 * Cantidad de símbolos "extras" que mantenemos en la tira fuera del
 * área visible (arriba y abajo) durante el spin — para que parezca
 * que hay símbolos llegando sin gaps visuales.
 */
const BUFFER_TOP = 2;
const BUFFER_BOTTOM = 2;
const TOTAL_SYMBOLS = REELS.ROWS + BUFFER_TOP + BUFFER_BOTTOM;

/** Pool fijo de símbolos para usar durante el spin (random). */
const ALL_SYMBOLS: SymbolCode[] = [
  'joker', 'crown', 'mandolin', 'boots', 'bolos', 'ruby', 'sapphire', 'emerald',
];

function randomSymbol(): SymbolCode {
  return ALL_SYMBOLS[Math.floor(Math.random() * ALL_SYMBOLS.length)]!;
}

export class Reel extends Container {
  private symbols: SymbolSprite[] = [];
  /** Símbolos finales del último spin (los 3 visibles cuando para). */
  private finalSymbols: SymbolCode[] = [];
  /** Mask Graphics que clipea el reel al área visible. */
  private maskGraphics: Graphics;
  /** Posición Y "virtual" de la tira durante el spin. */
  private stripY = 0;
  /** Filtro de motion blur — strength 0 cuando está parado, sube durante spin. */
  private blurFilter: BlurFilter;

  constructor(private readonly reelIndex: number, initialSymbols: SymbolCode[]) {
    super();

    // Mask para que los símbolos fuera de las 3 filas visibles se oculten.
    this.maskGraphics = new Graphics()
      .rect(0, 0, SYMBOL_SIZE.WIDTH, REELS.HEIGHT)
      .fill(0xffffff);
    this.addChild(this.maskGraphics);
    this.mask = this.maskGraphics;

    // Motion blur — siempre montado pero strengthY=0 cuando está parado.
    // CRÍTICO: solo se anima strengthY (vertical). strengthX se queda en 0
    // para siempre — de lo contrario los símbolos se ven como burbujas
    // redondas en lugar de líneas verticales de velocidad.
    this.blurFilter = new BlurFilter({ strength: 0, quality: 4 });
    this.blurFilter.strengthX = 0;
    this.blurFilter.strengthY = 0;
    this.filters = [this.blurFilter];

    // Inicializar la tira con TOTAL_SYMBOLS sprites.
    // Las 3 posiciones del medio son los initialSymbols, el resto random.
    for (let i = 0; i < TOTAL_SYMBOLS; i++) {
      const visibleIndex = i - BUFFER_TOP;
      let code: SymbolCode;
      if (visibleIndex >= 0 && visibleIndex < REELS.ROWS) {
        code = initialSymbols[visibleIndex] ?? randomSymbol();
      } else {
        code = randomSymbol();
      }
      const sprite = new SymbolSprite(code);
      const y = SYMBOL_SIZE.HEIGHT / 2 + visibleIndex * SYMBOL_SIZE.HEIGHT;
      sprite.position.set(SYMBOL_SIZE.WIDTH / 2, y);
      // Aplicar cylinder transform inicial (escalado según posición)
      this.applyCylinderTransform(sprite, y);
      this.symbols.push(sprite);
      this.addChild(sprite);
    }
    this.finalSymbols = [...initialSymbols];
  }

  /**
   * Spin este reel y, después del stagger, paralo en los símbolos
   * `finalSymbols` (los 3 visibles).
   *
   * @param finalSymbols Los 3 símbolos que deben quedar visibles al parar.
   * @returns Promise que resuelve cuando termina la animación de este reel.
   */
  spin(finalSymbols: SymbolCode[]): Promise<void> {
    return new Promise((resolve) => {
      this.finalSymbols = [...finalSymbols];

      // Duración total = base + stagger por reel index.
      const duration = (SPIN.BASE_DURATION_MS + this.reelIndex * SPIN.STAGGER_MS) / 1000;
      const cycleDistance = SPIN.SYMBOL_CYCLES * REELS.ROWS * SYMBOL_SIZE.HEIGHT;
      const scroll = { y: 0 };

      // Curva de animación REALISTA en 3 fases (mecánica de reel físico):
      //
      //   FASE 1 (ACCEL):  El reel arranca de 0 y acelera hasta velocidad
      //                    máxima. Corta — 15% duración, 5% distancia.
      //                    Ease: power2.in (acelera progresivo)
      //
      //   FASE 2 (CRUISE): Velocidad constante máxima — la mayor parte
      //                    del recorrido. 50% duración, 65% distancia.
      //                    Ease: none (linear — velocidad uniforme)
      //
      //   FASE 3 (DECEL):  Frenado dramático con anticipación al final.
      //                    35% duración, 30% distancia.
      //                    Ease: power3.out (frenado fuerte al final)
      const t1 = duration * 0.15;
      const t2 = duration * 0.50;
      const t3 = duration * 0.35;
      const d1 = cycleDistance * 0.05;
      const d2 = cycleDistance * 0.65;

      const tl = gsap.timeline({
        onComplete: () => {
          this.snapToFinal();
          resolve();
        },
      });

      tl.to(scroll, {
        y: d1,
        duration: t1,
        ease: 'power2.in',
        onUpdate: () => this.applyStripScroll(scroll.y),
      });
      tl.to(scroll, {
        y: d1 + d2,
        duration: t2,
        ease: 'none',
        onUpdate: () => this.applyStripScroll(scroll.y),
      });
      tl.to(scroll, {
        y: cycleDistance,
        duration: t3,
        ease: 'power3.out',
        onUpdate: () => this.applyStripScroll(scroll.y),
      });

      // Motion blur en paralelo — sincronizado con las fases:
      //   - Sube durante accel (0 → max en t1)
      //   - Hold durante cruise
      //   - Cae durante decel (últimos 60% de t3)
      const blurDownDuration = t3 * 0.6;
      const blurHoldDuration = duration - t1 - blurDownDuration;
      gsap.timeline()
        .to(this.blurFilter, {
          strengthY: MAX_BLUR_STRENGTH_Y,
          duration: t1,
          ease: 'power2.out',
        })
        .to(this.blurFilter, {
          strengthY: MAX_BLUR_STRENGTH_Y,
          duration: Math.max(0.01, blurHoldDuration),
        })
        .to(this.blurFilter, {
          strengthY: 0,
          duration: blurDownDuration,
          ease: 'power2.in',
        });
    });
  }

  /**
   * Aplica un offset Y a la tira virtual y reposiciona sprites
   * con wrap. También aplica el efecto CILINDRO (escala variable
   * según distancia al centro vertical).
   */
  private applyStripScroll(offset: number): void {
    const stripHeight = TOTAL_SYMBOLS * SYMBOL_SIZE.HEIGHT;
    this.stripY = offset % stripHeight;

    for (let i = 0; i < this.symbols.length; i++) {
      const sprite = this.symbols[i]!;
      const baseY = SYMBOL_SIZE.HEIGHT / 2 + (i - BUFFER_TOP) * SYMBOL_SIZE.HEIGHT;
      let y = baseY + this.stripY;

      // Wrap
      const reelBottom = REELS.HEIGHT + SYMBOL_SIZE.HEIGHT * BUFFER_BOTTOM;
      while (y > reelBottom) {
        y -= stripHeight;
        sprite.setSymbol(randomSymbol());
      }
      sprite.position.y = y;
      // Aplica el escalado de cilindro (3D illusion)
      this.applyCylinderTransform(sprite, y);
    }
  }

  /**
   * Aplica el efecto CILINDRO: escala variable + tint oscuro según la
   * distancia del símbolo al centro vertical del reel.
   *
   *   - En el CENTRO vertical: escala 1.0, tint full bright (1.0)
   *   - En los BORDES (top/bottom): escala 0.78, tint dim (0.6)
   *
   * La curva es CUADRÁTICA (no lineal) para simular la curvatura natural
   * de un cilindro físico — la perspectiva comprime más en los extremos.
   *
   * Esto crea la sensación de un cilindro rotante 3D en vez de un
   * rectángulo plano 2D.
   */
  private applyCylinderTransform(sprite: SymbolSprite, y: number): void {
    const centerY = REELS.HEIGHT / 2;
    const halfHeight = REELS.HEIGHT / 2;
    const distFromCenter = Math.abs(y - centerY);
    // Normalizado a [0, 1] donde 0 = centro, 1 = borde
    const t = Math.min(1, distFromCenter / halfHeight);
    // Curva cuadrática — efecto más fuerte en los extremos
    const tCurved = t * t;
    // Escala: 1.0 al centro, 0.78 en los bordes
    const scale = 1.0 - tCurved * 0.22;
    sprite.scale.set(scale);
    // Tint: el sprite se "oscurece" hacia los bordes (símbolos al fondo del cilindro)
    sprite.alpha = 1.0 - tCurved * 0.35;
  }

  /**
   * Al terminar el scroll, snapea los 3 sprites visibles a los
   * finalSymbols + bounce overshoot, manteniendo el cylinder transform.
   */
  private snapToFinal(): void {
    for (let i = 0; i < this.symbols.length; i++) {
      const sprite = this.symbols[i]!;
      const visibleIndex = i - BUFFER_TOP;
      let code: SymbolCode;
      if (visibleIndex >= 0 && visibleIndex < REELS.ROWS) {
        code = this.finalSymbols[visibleIndex] ?? randomSymbol();
      } else {
        code = randomSymbol();
      }
      sprite.setSymbol(code);
      const y = SYMBOL_SIZE.HEIGHT / 2 + visibleIndex * SYMBOL_SIZE.HEIGHT;
      sprite.position.y = y;
      this.applyCylinderTransform(sprite, y);
    }

    // Bounce overshoot SUTIL
    const overshoot = SYMBOL_SIZE.HEIGHT * 0.10;
    gsap.fromTo(
      this.symbols.map((s) => s.position),
      { y: `+=${overshoot}` },
      {
        y: `-=${overshoot}`,
        duration: 0.22,
        ease: 'back.out(3.5)',
      },
    );
  }
}
