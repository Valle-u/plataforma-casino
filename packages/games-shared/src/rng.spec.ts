/**
 * Tests del RNG determinístico.
 *
 * Lo crítico:
 *   - Mismo seed → misma secuencia de números (reproducibilidad).
 *   - Distinto seed → secuencia distinta.
 *   - next() en [0, 1).
 *   - nextInt(N) en [0, N).
 *   - No se "atasca" después de consumir el seed inicial (chain).
 */

import { describe, it, expect } from 'vitest';
import { createDeterministicRng } from './rng';

describe('createDeterministicRng', () => {
  it('rechaza seeds de tamaño incorrecto', () => {
    expect(() => createDeterministicRng(Buffer.alloc(31))).toThrow();
    expect(() => createDeterministicRng(Buffer.alloc(33))).toThrow();
    expect(() => createDeterministicRng(Buffer.alloc(0))).toThrow();
  });

  it('mismo seed produce la misma secuencia', () => {
    const seed = Buffer.alloc(32, 7);
    const a = createDeterministicRng(seed);
    const b = createDeterministicRng(seed);
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('seeds distintos producen secuencias distintas', () => {
    const a = createDeterministicRng(Buffer.alloc(32, 1));
    const b = createDeterministicRng(Buffer.alloc(32, 2));
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  describe('next()', () => {
    it('devuelve floats en [0, 1)', () => {
      const rng = createDeterministicRng(Buffer.alloc(32, 13));
      for (let i = 0; i < 1000; i++) {
        const v = rng.next();
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    });

    it('no se atasca después de consumir el seed inicial (encadena)', () => {
      // Seed de 32 bytes son 4 uint64 = 4 floats antes de re-hash.
      // Pedimos 10000 floats — fuerza el chaining muchas veces.
      const rng = createDeterministicRng(Buffer.alloc(32, 0xff));
      const values = new Set<number>();
      for (let i = 0; i < 10000; i++) {
        values.add(rng.next());
      }
      // Esperamos altísima entropía — la chance de colisión es prácticamente cero.
      expect(values.size).toBeGreaterThan(9990);
    });

    it('aprox uniforme en [0,1) — promedio cerca de 0.5 sobre 100k muestras', () => {
      const rng = createDeterministicRng(Buffer.alloc(32, 42));
      let sum = 0;
      const n = 100_000;
      for (let i = 0; i < n; i++) sum += rng.next();
      const avg = sum / n;
      expect(avg).toBeGreaterThan(0.49);
      expect(avg).toBeLessThan(0.51);
    });
  });

  describe('nextInt()', () => {
    it('devuelve enteros en [0, max)', () => {
      const rng = createDeterministicRng(Buffer.alloc(32, 5));
      for (let i = 0; i < 1000; i++) {
        const v = rng.nextInt(10);
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(10);
      }
    });

    it('cubre todo el rango uniformemente sobre 100k muestras', () => {
      const rng = createDeterministicRng(Buffer.alloc(32, 99));
      const counts = new Array<number>(10).fill(0);
      const n = 100_000;
      for (let i = 0; i < n; i++) {
        counts[rng.nextInt(10)]!++;
      }
      // Cada bucket debe tener ~10000 ± 5% (tolerancia generosa).
      for (const c of counts) {
        expect(c).toBeGreaterThan(n / 10 * 0.95);
        expect(c).toBeLessThan(n / 10 * 1.05);
      }
    });

    it('rechaza max inválido', () => {
      const rng = createDeterministicRng(Buffer.alloc(32, 0));
      expect(() => rng.nextInt(0)).toThrow();
      expect(() => rng.nextInt(-5)).toThrow();
      expect(() => rng.nextInt(1.5)).toThrow();
    });
  });

  describe('pick()', () => {
    it('devuelve un elemento del array', () => {
      const rng = createDeterministicRng(Buffer.alloc(32, 1));
      const arr = ['a', 'b', 'c', 'd', 'e'];
      for (let i = 0; i < 100; i++) {
        expect(arr).toContain(rng.pick(arr));
      }
    });

    it('cubre todos los elementos sobre suficientes samples', () => {
      const rng = createDeterministicRng(Buffer.alloc(32, 33));
      const arr = [1, 2, 3, 4, 5];
      const seen = new Set<number>();
      for (let i = 0; i < 1000; i++) seen.add(rng.pick(arr));
      expect(seen.size).toBe(5);
    });

    it('tira en array vacío', () => {
      const rng = createDeterministicRng(Buffer.alloc(32, 0));
      expect(() => rng.pick([])).toThrow();
    });
  });
});
