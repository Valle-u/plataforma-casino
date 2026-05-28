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

import { Container, Graphics, Sprite, Texture, TilingSprite, Assets, BlurFilter } from 'pixi.js';
import gsap from 'gsap';
import type { SymbolCode } from '@casino/games-jokers-jewels';
import { SymbolSprite } from './SymbolSprite';
import { SYMBOL_SIZE, REELS, SPIN } from '../core/Layout';

/** Strength máximo del motion blur VERTICAL durante el spin a máxima velocidad. */
const MAX_BLUR_STRENGTH_Y = 36;

/**
 * Stretch vertical máximo de los símbolos a máxima velocidad. Los reels
 * físicos no solo se desenfocan: el sprite se "estira" en el eje del
 * movimiento. +24% de alto a full speed le da peso y sensación de velocidad.
 */
const MAX_STRETCH = 0.24;

/** Alpha máximo de las speed lines (overlay de líneas de velocidad) en cruise. */
const MAX_SPEEDLINES_ALPHA = 0.28;

/** Multiplicador de duración cuando el reel está en modo anticipation. */
const ANTICIPATION_FACTOR = 1.9;

/**
 * Genera una textura de líneas de velocidad verticales — un row de 1px
 * con barras blancas semitransparentes en X aleatorios. Estirada a lo
 * alto del reel da líneas verticales perfectas (el "streak" del movimiento).
 */
function createSpeedLinesTexture(): Texture {
  const W = Math.round(SYMBOL_SIZE.WIDTH);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context no disponible');

  // ~14 streaks de ancho y alpha variable para que no sea uniforme.
  const STREAKS = 14;
  for (let i = 0; i < STREAKS; i++) {
    const x = Math.floor(Math.random() * W);
    const width = 1 + Math.floor(Math.random() * 2);
    const alpha = 0.25 + Math.random() * 0.6;
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.fillRect(x, 0, width, 1);
  }
  return Texture.from(canvas);
}

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
  /** Stretch vertical actual de los símbolos (0 parado, sube en cruise). */
  private spinStretch = 0;
  /** Overlay de líneas de velocidad — alpha 0 parado, sube en cruise. */
  private speedLines: Sprite;
  /** Fondo texturado del reel (patrón + bordes dorados) que scrollea en el spin. */
  private reelStrip: TilingSprite | null = null;

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

    // Fondo texturado de la columna (detrás de los símbolos). Se tilea
    // verticalmente: scrolleamos `tilePosition.y` durante el spin para
    // que el patrón/cilindro se desplace junto con los símbolos.
    const stripTex = Assets.get<Texture>('reel.strip');
    if (stripTex) {
      const strip = new TilingSprite({
        texture: stripTex,
        width: SYMBOL_SIZE.WIDTH,
        height: REELS.HEIGHT,
      });
      // Escala la textura para que su ancho llene exactamente la columna;
      // la altura escalada (~REELS.HEIGHT) define el período del loop.
      strip.tileScale.set(SYMBOL_SIZE.WIDTH / stripTex.width);
      this.reelStrip = strip;
      this.addChild(strip);
    }

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
      this.applyVelocityStretch(sprite);
      this.symbols.push(sprite);
      this.addChild(sprite);
    }
    this.finalSymbols = [...initialSymbols];

    // Speed lines overlay — encima de los símbolos, masked junto al reel.
    // Estirado a todo el alto; blend 'add' para que sume luz sin tapar.
    this.speedLines = new Sprite(createSpeedLinesTexture());
    this.speedLines.width = SYMBOL_SIZE.WIDTH;
    this.speedLines.height = REELS.HEIGHT;
    this.speedLines.blendMode = 'add';
    this.speedLines.alpha = 0;
    this.addChild(this.speedLines);
  }

  /**
   * Spin este reel y, después del stagger, paralo en los símbolos
   * `finalSymbols` (los 3 visibles).
   *
   * @param finalSymbols Los 3 símbolos que deben quedar visibles al parar.
   * @param anticipate Si true, el reel frena mucho más lento (momento de tensión).
   * @returns Promise que resuelve cuando termina la animación de este reel.
   */
  spin(finalSymbols: SymbolCode[], anticipate = false): Promise<void> {
    return new Promise((resolve) => {
      this.finalSymbols = [...finalSymbols];

      // Duración total = base + stagger por reel index. La anticipation
      // estira el recorrido completo para que el reel "cuelgue" en tensión.
      const baseDuration = (SPIN.BASE_DURATION_MS + this.reelIndex * SPIN.STAGGER_MS) / 1000;
      const duration = anticipate ? baseDuration * ANTICIPATION_FACTOR : baseDuration;
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

      // Efectos de velocidad en paralelo (blur + stretch + speed lines),
      // sincronizados con las fases:
      //   - Suben durante accel (0 → max en t1)
      //   - Hold durante cruise
      //   - Caen durante decel (últimos 60% de t3)
      const blurDownDuration = t3 * 0.6;
      const blurHoldDuration = duration - t1 - blurDownDuration;

      // Proxy con las 3 magnitudes de velocidad — un solo tween las mueve
      // juntas y el onUpdate las vuelca al filtro / stretch / overlay.
      const speed = { blur: 0, stretch: 0, lines: 0 };
      const applySpeed = (): void => {
        this.blurFilter.strengthY = speed.blur;
        this.spinStretch = speed.stretch;
        this.speedLines.alpha = speed.lines;
      };

      gsap.timeline()
        .to(speed, {
          blur: MAX_BLUR_STRENGTH_Y,
          stretch: MAX_STRETCH,
          lines: MAX_SPEEDLINES_ALPHA,
          duration: t1,
          ease: 'power2.out',
          onUpdate: applySpeed,
        })
        .to(speed, {
          blur: MAX_BLUR_STRENGTH_Y,
          stretch: MAX_STRETCH,
          lines: MAX_SPEEDLINES_ALPHA,
          duration: Math.max(0.01, blurHoldDuration),
          onUpdate: applySpeed,
        })
        .to(speed, {
          blur: 0,
          stretch: 0,
          lines: 0,
          duration: blurDownDuration,
          ease: 'power2.in',
          onUpdate: applySpeed,
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

    // El fondo texturado scrollea a la misma velocidad lineal que los
    // símbolos. El TilingSprite wrapea infinito, así que basta con
    // setear el offset crudo (sin módulo).
    if (this.reelStrip) {
      this.reelStrip.tilePosition.y = offset;
    }

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
      this.applyVelocityStretch(sprite);
    }
  }

  /**
   * Aplica el stretch de velocidad a un símbolo. TODOS los símbolos se
   * mantienen del MISMO tamaño y brillo sin importar su fila — la
   * profundidad del "cilindro" la aporta el vignette que oscurece
   * top/bottom del reel (capa aparte en Reels.ts), no el escalado por
   * símbolo (que hacía que la fila del medio se viera más grande).
   *
   * El único efecto que varía es el squash vertical durante el spin
   * (`spinStretch`), que es uniforme para toda la tira.
   */
  private applyVelocityStretch(sprite: SymbolSprite): void {
    sprite.scale.x = 1.0;
    sprite.scale.y = 1 + this.spinStretch;
    sprite.alpha = 1.0;
  }

  /**
   * Al terminar el scroll, snapea los 3 sprites visibles a los
   * finalSymbols + bounce overshoot, manteniendo el cylinder transform.
   */
  private snapToFinal(): void {
    // Asegurar que los efectos de velocidad quedaron en cero al parar.
    this.spinStretch = 0;
    this.speedLines.alpha = 0;
    this.blurFilter.strengthY = 0;

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
      this.applyVelocityStretch(sprite);
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
