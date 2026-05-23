/**
 * confetti.ts — Sprint 51.11 dopamine helper.
 *
 * Wrapper de `canvas-confetti` con presets temáticos. Lo aislamos
 * en una util para:
 *   - Centralizar paleta (accent del tenant + dorado para "premio grande").
 *   - Disparar con haptic feedback en mobile (vibration API).
 *   - SSR-safe: en server no hace nada.
 *
 * Presets:
 *   - `confettiBurst()` — explosión central, default. Para spin wheel
 *     win, streak claim, deposit aprobado.
 *   - `confettiJackpot()` — más intenso (más partículas + dorado).
 *     Para win grande (>10k chips), top 1 liga, etc.
 *   - `confettiSide()` — 2 chorros desde los costados. Para milestones
 *     (subir de nivel, completar racha 7 días).
 */

import confetti from 'canvas-confetti';

const DEFAULT_COLORS = ['#C53030', '#FFD700', '#fff'];
const JACKPOT_COLORS = ['#FFD700', '#FFA500', '#C53030', '#fff'];

export function confettiBurst(): void {
  if (typeof window === 'undefined') return;
  void confetti({
    particleCount: 80,
    spread: 70,
    origin: { y: 0.6 },
    colors: DEFAULT_COLORS,
    scalar: 0.9,
    ticks: 200,
  });
  hapticTap();
}

export function confettiJackpot(): void {
  if (typeof window === 'undefined') return;
  // Disparo 1: explosión grande central.
  void confetti({
    particleCount: 150,
    spread: 100,
    origin: { y: 0.5 },
    colors: JACKPOT_COLORS,
    scalar: 1.2,
    ticks: 300,
  });
  // Disparo 2: rezago para sensación de "lluvia continua".
  setTimeout(() => {
    void confetti({
      particleCount: 60,
      spread: 120,
      origin: { y: 0.4 },
      colors: JACKPOT_COLORS,
      scalar: 0.8,
      ticks: 250,
    });
  }, 200);
  setTimeout(() => {
    void confetti({
      particleCount: 60,
      spread: 120,
      origin: { y: 0.4 },
      colors: JACKPOT_COLORS,
      scalar: 0.7,
      ticks: 220,
    });
  }, 400);
  hapticBurst();
}

export function confettiSide(): void {
  if (typeof window === 'undefined') return;
  // Izquierda → derecha
  void confetti({
    particleCount: 50,
    angle: 60,
    spread: 55,
    origin: { x: 0, y: 0.7 },
    colors: DEFAULT_COLORS,
  });
  void confetti({
    particleCount: 50,
    angle: 120,
    spread: 55,
    origin: { x: 1, y: 0.7 },
    colors: DEFAULT_COLORS,
  });
  hapticTap();
}

// ──────────────────────────────────────────────────────────────────────
// Haptic feedback (mobile vibration API)
// ──────────────────────────────────────────────────────────────────────

function hapticTap(): void {
  if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return;
  try {
    navigator.vibrate(15);
  } catch {
    /* user blocked or no support */
  }
}

function hapticBurst(): void {
  if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return;
  try {
    navigator.vibrate([30, 50, 30, 50, 30]);
  } catch {
    /* ignore */
  }
}
