/**
 * ReelDividerLights — streaks de luz entre los reels durante el spin.
 *
 * Estrategia: generamos una textura procedural en HTML Canvas con un
 * gradient horizontal pre-calculado (transparente → bright → transparente)
 * y la usamos como Sprite × 4. Esto da:
 *   - Glow real con falloff suave (no rects pintados)
 *   - Edges totalmente difusos sin BlurFilter (más performante)
 *   - Pixel-perfect (sin issues de v8 FillGradient con rgba strings)
 *   - blendMode 'add' para que la luz SE SUME al fondo violet
 *
 * El texture es 1 sola textura cacheada, reutilizada en 4 Sprites.
 */

import { Container, Sprite, Texture } from 'pixi.js';
import gsap from 'gsap';
import { REELS, SYMBOL_SIZE } from '../core/Layout';

/** Ancho de cada streak sprite en design units (incluye el halo difuso). */
const STREAK_DRAW_WIDTH = 80;

/**
 * Crea una textura de light streak vertical via HTML Canvas en 2 pasadas:
 *
 *   PASADA 1 — Horizontal gradient con falloff suave (transparente
 *              en los bordes laterales → centro dorado cálido)
 *   PASADA 2 — Vertical fade mask usando 'destination-in' compositing
 *              (recorta la alpha de la pasada 1 para que se desvanezca
 *               en top y bottom)
 *
 * Resultado: un haz de luz que se ve REAL — fade en los 4 lados,
 * centro cálido dorado, sin edges sharp en ningún lado.
 */
function createStreakTexture(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context no disponible');

  // ─── PASADA 1: gradient horizontal (la forma del streak) ──────────
  // Falloff más SUAVE — el centro brillante es más angosto, los lados
  // tienen una rampa más gradual. Tono dorado cálido (no blanco-hot).
  const hGrad = ctx.createLinearGradient(0, 0, canvas.width, 0);
  hGrad.addColorStop(0.0,  'rgba(255, 180, 0, 0)');
  hGrad.addColorStop(0.2,  'rgba(255, 200, 50, 0.15)');
  hGrad.addColorStop(0.35, 'rgba(255, 215, 90, 0.5)');
  hGrad.addColorStop(0.45, 'rgba(255, 235, 150, 0.85)');
  hGrad.addColorStop(0.5,  'rgba(255, 245, 200, 1)');     // centro dorado cálido
  hGrad.addColorStop(0.55, 'rgba(255, 235, 150, 0.85)');
  hGrad.addColorStop(0.65, 'rgba(255, 215, 90, 0.5)');
  hGrad.addColorStop(0.8,  'rgba(255, 200, 50, 0.15)');
  hGrad.addColorStop(1.0,  'rgba(255, 180, 0, 0)');

  ctx.fillStyle = hGrad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // ─── PASADA 2: vertical fade mask ─────────────────────────────────
  // destination-in mantiene solo donde AMBAS layers tienen alpha.
  // Con un gradient vertical que va de transparent → opaque → transparent,
  // recortamos la pasada 1 para que también fadee en top y bottom.
  ctx.globalCompositeOperation = 'destination-in';
  const vGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  vGrad.addColorStop(0.0,  'rgba(255, 255, 255, 0)');     // top fade
  vGrad.addColorStop(0.12, 'rgba(255, 255, 255, 0.7)');
  vGrad.addColorStop(0.25, 'rgba(255, 255, 255, 1)');
  vGrad.addColorStop(0.75, 'rgba(255, 255, 255, 1)');
  vGrad.addColorStop(0.88, 'rgba(255, 255, 255, 0.7)');
  vGrad.addColorStop(1.0,  'rgba(255, 255, 255, 0)');     // bottom fade

  ctx.fillStyle = vGrad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Resetear para no afectar usos futuros del canvas (defensive)
  ctx.globalCompositeOperation = 'source-over';

  return Texture.from(canvas);
}

export class ReelDividerLights extends Container {
  private streaks: Sprite[] = [];
  private tweens: gsap.core.Tween[] = [];

  constructor() {
    super();
    this.position.set(
      REELS.CENTER_X - REELS.WIDTH / 2,
      REELS.CENTER_Y - REELS.HEIGHT / 2,
    );

    const texture = createStreakTexture();

    // 4 dividers en x = SYMBOL_SIZE.WIDTH × {1,2,3,4}
    for (let d = 1; d < REELS.COLS; d++) {
      const x = d * SYMBOL_SIZE.WIDTH;
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5, 0); // centrado X, anclado al top
      sprite.position.set(x, 0);
      sprite.width = STREAK_DRAW_WIDTH;
      sprite.height = REELS.HEIGHT;
      sprite.blendMode = 'add';
      sprite.alpha = 0;
      this.streaks.push(sprite);
      this.addChild(sprite);
    }
  }

  /**
   * Spinning state — true fade-in, false fade-out.
   */
  setSpinning(spinning: boolean): void {
    if (spinning) this.fadeIn();
    else this.fadeOut();
  }

  private fadeIn(): void {
    this.killTweens();
    for (const s of this.streaks) {
      this.tweens.push(
        gsap.to(s, { alpha: 1.0, duration: 0.15, ease: 'power2.out' }),
      );
    }
  }

  private fadeOut(): void {
    this.killTweens();
    for (const s of this.streaks) {
      this.tweens.push(
        gsap.to(s, { alpha: 0, duration: 0.25, ease: 'power2.in' }),
      );
    }
  }

  private killTweens(): void {
    this.tweens.forEach((t) => {
      t.kill();
    });
    this.tweens = [];
  }
}
