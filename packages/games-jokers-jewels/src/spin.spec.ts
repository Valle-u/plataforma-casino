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
import { spin } from './spin';
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
