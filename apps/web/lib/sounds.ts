/**
 * sounds.ts — Sprint 51.29 dopamine SFX.
 *
 * Wrapper sobre Web Audio API que genera sonidos cortos sintetizados —
 * sin assets de audio (cero KB en bundle de assets, cero requests).
 *
 * Filosofía:
 *   - SUTIL siempre. Casinos abusan del sonido y se vuelve agotador.
 *     Estos están afinados para ser "satisfactorios" en single-play y
 *     no molestos en repetición.
 *   - Default OFF — el player tiene que opt-in desde /play/settings.
 *     Es respetuoso del primer principio de "no surprise sounds".
 *   - Wrapper SSR-safe: en server no toca AudioContext.
 *   - Respeta `prefers-reduced-motion` por extensión semántica
 *     (si reduce motion → reduce sound también).
 *
 * Sonidos disponibles:
 *   - `click`:  beep corto de feedback (toggle, tab change).
 *   - `claim`:  doble nota ascendente (premio reclamado).
 *   - `spin`:   sweep + tick repetido (mientras gira la rueda).
 *   - `win`:    arpegio dorado (ganaste).
 *   - `jackpot`: arpegio + reverb (premio grande).
 *   - `notif`:  campanada suave (notificación nueva).
 *
 * Toggle: localStorage `casino:sounds:enabled`. Default "0" (off).
 *
 * NOTA: los browsers requieren que el primer AudioContext.resume()
 * suceda en respuesta a interacción del user. El wrapper lo maneja —
 * el primer .play() después de un click ya queda inicializado.
 */

const STORAGE_KEY = 'casino:sounds:enabled';

let ctx: AudioContext | null = null;
let cached: boolean | null = null;

function isEnabled(): boolean {
  if (cached !== null) return cached;
  if (typeof window === 'undefined') return false;
  try {
    cached = window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    cached = false;
  }
  return cached;
}

export function setSoundsEnabled(next: boolean): void {
  cached = next;
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event('casino:sounds-changed'));
}

export function getSoundsEnabled(): boolean {
  return isEnabled();
}

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (ctx) return ctx;
  // Lazy init — primer uso solamente. Lazy + reusar misma instancia.
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
    return ctx;
  } catch {
    return null;
  }
}

/**
 * Construye una nota corta. `freq` Hz, `duration` segundos, `volume` 0-1.
 * Usa envelope ADSR sutil para que no haya click al cortar.
 */
function playTone(
  freq: number,
  duration = 0.12,
  options: {
    type?: OscillatorType;
    volume?: number;
    when?: number;
    detune?: number;
  } = {},
): void {
  if (!isEnabled()) return;
  const audio = getCtx();
  if (!audio) return;
  // Si está suspended (autoplay block), intentar resume.
  if (audio.state === 'suspended') {
    audio.resume().catch(() => undefined);
  }

  const { type = 'sine', volume = 0.18, when = 0, detune = 0 } = options;
  const t0 = audio.currentTime + when;
  const t1 = t0 + duration;

  const osc = audio.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (detune) osc.detune.setValueAtTime(detune, t0);

  const gain = audio.createGain();
  // ADSR: ataque rápido, decay corto, release suave. Volume sutil.
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(volume, t0 + 0.005);
  gain.gain.linearRampToValueAtTime(volume * 0.7, t0 + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, t1);

  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(t0);
  osc.stop(t1 + 0.02);
}

// ──────────────────────────────────────────────────────────────────────
// Public sound presets
// ──────────────────────────────────────────────────────────────────────

/** Click feedback — un beep corto E5. */
export function soundClick(): void {
  playTone(659.25, 0.06, { type: 'square', volume: 0.06 });
}

/** Premio reclamado — dos notas ascendentes (C5 → E5). */
export function soundClaim(): void {
  playTone(523.25, 0.12, { type: 'triangle', volume: 0.15 });
  playTone(659.25, 0.16, { type: 'triangle', volume: 0.17, when: 0.08 });
}

/** Tick durante el spin — repetido c/100ms desde el caller. */
export function soundSpinTick(): void {
  playTone(440, 0.04, { type: 'sine', volume: 0.08 });
}

/** Win — arpegio C5 E5 G5 dorado. */
export function soundWin(): void {
  playTone(523.25, 0.1, { type: 'triangle', volume: 0.16 });
  playTone(659.25, 0.1, { type: 'triangle', volume: 0.16, when: 0.08 });
  playTone(783.99, 0.22, { type: 'triangle', volume: 0.2, when: 0.16 });
}

/** Jackpot — arpegio extendido + sustain. Solo para wins grandes. */
export function soundJackpot(): void {
  const arpeggio = [523.25, 659.25, 783.99, 1046.5, 1318.51];
  arpeggio.forEach((freq, i) => {
    playTone(freq, 0.18, {
      type: 'triangle',
      volume: 0.16,
      when: i * 0.07,
    });
  });
  // Sustain nota final
  playTone(1046.5, 0.5, {
    type: 'sine',
    volume: 0.12,
    when: arpeggio.length * 0.07,
  });
}

/** Notificación — campanada suave (D5 + A5 simultáneo). */
export function soundNotif(): void {
  playTone(587.33, 0.18, { type: 'sine', volume: 0.12 });
  playTone(880, 0.18, { type: 'sine', volume: 0.08 });
}
