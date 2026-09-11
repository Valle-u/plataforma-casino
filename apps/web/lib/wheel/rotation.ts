/**
 * Rotación de la rueda por rAF. Dos fases:
 *
 *  1. `idle()` — mientras esperás la respuesta del POST, la rueda gira a
 *     velocidad constante (suspenso).
 *  2. `land()` — conociendo el gajo ganador, desacelera con easeOutCubic y deja
 *     ese gajo EXACTAMENTE centrado en el puntero (las 12).
 *
 * Todo por rAF (no por `transition` CSS) porque la fase de espera tiene duración
 * impredecible: no podés saber con antelación cuánto girar ni sobre qué ángulo.
 * Concretamente: se cancela el frame en curso y se anima desde el ángulo actual
 * hacia el objetivo — `state` nunca entra en el medio.
 */

const REV = 360;

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export class WheelRotation {
  private el: SVGGElement | null = null;
  private raf = 0;
  private angle = 0;

  /** Fija el `<g>` rotante y lo resetea al ángulo 0. */
  attach(el: SVGGElement | null): void {
    this.cancel();
    this.el = el;
    this.angle = 0;
    this.apply();
  }

  detach(): void {
    this.cancel();
    this.el = null;
  }

  private apply(): void {
    if (this.el) this.el.style.transform = `rotate(${this.angle}deg)`;
  }

  private cancel(): void {
    if (this.raf !== 0) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  /** Velocidad constante hasta que venga el resultado o se corte. */
  idle(revsPerSec = 1.4): void {
    this.cancel();
    const start = performance.now();
    const from = this.angle;
    const step = (now: number): void => {
      this.angle = from + ((now - start) / 1000) * revsPerSec * REV;
      this.apply();
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  /**
   * Desacelera hasta dejar el gajo `segmentIndex` centrado en el puntero.
   * El gajo `i` nace con su centro en `(i + 0.5) * (360 / total)`, medido en
   * sentido horario desde las 12 (el mismo orden con que se dibuja el SVG).
   * Se busca `angle` tal que `centro + angle ≡ 0 (mod 360)`.
   */
  land(
    segmentIndex: number,
    totalSegments: number,
    opts: { durationMs?: number; minTurns?: number } = {},
  ): Promise<void> {
    const { durationMs = 4000, minTurns = 6 } = opts;
    return new Promise((resolve) => {
      this.cancel();
      const segmentAngle = REV / totalSegments;
      const targetInRev =
        (REV - ((segmentIndex + 0.5) * segmentAngle) % REV) % REV;
      // Que el ángulo crezca (misma dirección que el giro) y complete vueltas.
      let target = targetInRev;
      while (target < this.angle + minTurns * REV) target += REV;

      const from = this.angle;
      const start = performance.now();
      const step = (now: number): void => {
        const t = Math.min(1, (now - start) / durationMs);
        this.angle = from + (target - from) * easeOutCubic(t);
        this.apply();
        if (t < 1) {
          this.raf = requestAnimationFrame(step);
        } else {
          this.angle = target;
          this.apply();
          resolve();
        }
      };
      this.raf = requestAnimationFrame(step);
    });
  }

  stop(): void {
    this.cancel();
  }
}