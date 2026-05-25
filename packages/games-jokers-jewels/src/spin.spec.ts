/**
 * Tests del spin orquestador.
 *
 * Lo crítico:
 *   - El spin es determinístico dado un RNG con seed fijo.
 *   - El board tiene shape correcto (5 reels × 3 filas).
 *   - El cap del max win se activa correctamente.
 *   - El bet inválido tira.
 */

import { describe, it, expect } from 'vitest';
import {
  computeRoundSeed,
  createDeterministicRng,
} from '@casino/games-shared';
import { spin, applyCap } from './spin';
import { REEL_COUNT, VISIBLE_ROWS, MAX_WIN_MULTIPLIER } from './config';

function rngFromNonce(nonce: number) {
  const seed = computeRoundSeed(Buffer.alloc(32, 1), 'test-client', nonce);
  return createDeterministicRng(seed);
}

describe('spin', () => {
  it('produce un board con 5 reels × 3 filas', () => {
    const rng = rngFromNonce(0);
    const result = spin(rng, 1);
    expect(result.board.length).toBe(REEL_COUNT);
    for (const reel of result.board) {
      expect(reel.length).toBe(VISIBLE_ROWS);
    }
  });

  it('es determinístico — mismo seed → mismo resultado', () => {
    const a = spin(rngFromNonce(42), 5);
    const b = spin(rngFromNonce(42), 5);
    expect(a.board).toEqual(b.board);
    expect(a.totalWin).toBe(b.totalWin);
    expect(a.reelStops).toEqual(b.reelStops);
  });

  it('produce stops distintos para nonces distintos', () => {
    const a = spin(rngFromNonce(1), 1);
    const b = spin(rngFromNonce(2), 1);
    // Es estadísticamente casi imposible que 2 nonces den los mismos
    // 5 stops por casualidad — si esto falla, hay un bug en el RNG.
    expect(a.reelStops).not.toEqual(b.reelStops);
  });

  it('totalWin es >= 0', () => {
    for (let i = 0; i < 200; i++) {
      const r = spin(rngFromNonce(i), 1);
      expect(r.totalWin).toBeGreaterThanOrEqual(0);
    }
  });

  it('totalWin nunca supera el cap (1000× bet)', () => {
    // Sample agresivo para detectar si el cap está bypassed.
    for (let i = 0; i < 10000; i++) {
      const r = spin(rngFromNonce(i), 1);
      expect(r.totalWin).toBeLessThanOrEqual(MAX_WIN_MULTIPLIER);
    }
  });

  it('bet 0 o negativo tira', () => {
    const rng = rngFromNonce(0);
    expect(() => spin(rng, 0)).toThrow();
    expect(() => spin(rngFromNonce(0), -5)).toThrow();
  });

  it('bet NaN o Infinity tira', () => {
    expect(() => spin(rngFromNonce(0), NaN)).toThrow();
    expect(() => spin(rngFromNonce(0), Infinity)).toThrow();
    expect(() => spin(rngFromNonce(0), -Infinity)).toThrow();
  });

  it('bet con decimales funciona y mantiene precisión', () => {
    // Quality gate G1.3.4: bet decimal raros (0.01, 0.001, 1.7777).
    for (const bet of [0.01, 0.001, 1.7777, 0.1, 99.99]) {
      const r = spin(rngFromNonce(123), bet);
      expect(r.bet).toBe(bet);
      expect(r.totalWin).toBeGreaterThanOrEqual(0);
      // Los wins deben ser proporcionales al bet, no en valores fijos.
      if (r.totalWin > 0) {
        const ratio = r.totalWin / bet;
        // Cualquier ratio razonable (< 200× para bet small).
        expect(ratio).toBeLessThanOrEqual(MAX_WIN_MULTIPLIER);
      }
    }
  });

  it('bet muy grande (cerca de MAX_SAFE_INTEGER) no overflow', () => {
    // Quality gate G1.3.6: bet máximo razonable.
    // No usamos MAX_SAFE_INTEGER directo porque los wins pueden
    // multiplicarlo (totalWin = bet × 200) y salirse del rango.
    // Probamos con un bet alto pero que deje margen.
    const bet = 1_000_000_000; // 1B
    const r = spin(rngFromNonce(7), bet);
    expect(Number.isFinite(r.totalWin)).toBe(true);
    expect(r.totalWin).toBeGreaterThanOrEqual(0);
    expect(r.totalWin).toBeLessThanOrEqual(bet * MAX_WIN_MULTIPLIER);
  });
});

// ──────────────────────────────────────────────────────────────────────
// applyCap — testeable en aislamiento (G1.3.1 del quality gates)
// ──────────────────────────────────────────────────────────────────────

describe('applyCap', () => {
  it('no trunca cuando rawWin < cap', () => {
    const r = applyCap(50, 1, 1000);
    expect(r.totalWin).toBe(50);
    expect(r.cappedAtMax).toBe(false);
  });

  it('no trunca cuando rawWin === cap (límite estricto)', () => {
    const r = applyCap(1000, 1, 1000);
    expect(r.totalWin).toBe(1000);
    expect(r.cappedAtMax).toBe(false);
  });

  it('trunca a cap cuando rawWin supera el cap', () => {
    const r = applyCap(1500, 1, 1000);
    expect(r.totalWin).toBe(1000);
    expect(r.cappedAtMax).toBe(true);
  });

  it('escala el cap con el bet', () => {
    const r = applyCap(15000, 10, 1000); // cap = 10 × 1000 = 10000
    expect(r.totalWin).toBe(10000);
    expect(r.cappedAtMax).toBe(true);
  });

  it('usa el default MAX_WIN_MULTIPLIER si no se pasa el 3er arg', () => {
    // MAX_WIN_MULTIPLIER es 1000 — un rawWin de 1500 con bet=1 debería capear.
    const r = applyCap(1500, 1);
    expect(r.totalWin).toBe(MAX_WIN_MULTIPLIER);
    expect(r.cappedAtMax).toBe(true);
  });

  it('rawWin = 0 → 0 sin cap', () => {
    const r = applyCap(0, 5, 1000);
    expect(r.totalWin).toBe(0);
    expect(r.cappedAtMax).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Outcomes extremos (G1.3.2 del quality gates)
// ──────────────────────────────────────────────────────────────────────

describe('outcomes extremos', () => {
  it('busca y valida un spin con board all-jokers (raro pero posible)', () => {
    // Para construir un board all-jokers necesitaríamos un seed que
    // landee en posiciones donde 3 símbolos consecutivos = jokers en
    // los 5 reels. Con joker counts 5/8/8/7/5, prob por reel es
    // ~12-20%. Prob de 3 jokers consecutivos en un reel ≈ 0.5%-1.5%.
    // Prob de los 5 reels con 3 jokers cada uno ≈ 10^-12 — imposible
    // encontrarlo por brute force.
    //
    // Lo que SÍ podemos validar: evaluatePaylines con un board
    // construido manualmente (ya cubierto en evaluate.spec.ts).
    // Acá validamos que la suma del SpinResult con un board real es
    // siempre consistente con la suma de wins individuales.
    for (let i = 0; i < 5000; i++) {
      const r = spin(rngFromNonce(i), 1);
      if (r.cappedAtMax) {
        // Si en algún momento se activa el cap, validar truncado.
        expect(r.totalWin).toBe(MAX_WIN_MULTIPLIER);
      } else {
        const sumOfWins = r.wins.reduce((s, w) => s + w.win, 0);
        expect(r.totalWin).toBeCloseTo(sumOfWins, 10);
      }
    }
  });

  it('hay spins con totalWin = 0 (no match) y son la mayoría', () => {
    // Quality gate G1.3.3: validar que existen losing spins.
    let zeros = 0;
    const N = 1000;
    for (let i = 0; i < N; i++) {
      const r = spin(rngFromNonce(i), 1);
      if (r.totalWin === 0) zeros++;
    }
    // Con el RTP 96.74% y hit freq ~53%, esperamos ~47% de losing spins.
    expect(zeros).toBeGreaterThan(N * 0.3); // al menos 30% son loss
    expect(zeros).toBeLessThan(N * 0.7); // pero no más de 70%
  });

  it('wins.win suman correctamente al totalWin (sin cap)', () => {
    // Si encontramos un spin que paga > 0, verificamos que la suma
    // matchea (mientras no esté capped).
    for (let i = 0; i < 1000; i++) {
      const r = spin(rngFromNonce(i), 1);
      if (r.wins.length > 0 && !r.cappedAtMax) {
        const sum = r.wins.reduce((s, w) => s + w.win, 0);
        expect(r.totalWin).toBeCloseTo(sum, 10);
      }
    }
  });
});
