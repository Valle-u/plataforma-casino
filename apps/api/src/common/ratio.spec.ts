/**
 * Unit test del helper de conversión ficha↔plata (Blindaje núcleo, Parte B).
 * Aritmética BigInt: sin pérdida de precisión, redondeo half-up a 2 decimales.
 */

import { chipsFromFiat, fiatFromChips } from './ratio';

describe('ratio · chipsFromFiat (fichas = monto × ratio)', () => {
  it('ratio 1 (1 ficha = 1 peso): fichas = monto', () => {
    expect(chipsFromFiat('5000.00', '1.0000')).toBe('5000.00');
  });

  it('ratio 1000 (USDT): 10 → 10000 fichas', () => {
    expect(chipsFromFiat('10.00', '1000.0000')).toBe('10000.00');
  });

  it('ratio fraccionario 1.5', () => {
    expect(chipsFromFiat('100.50', '1.5000')).toBe('150.75');
  });

  it('redondea half-up a 2 decimales', () => {
    // 10 × 0.3333 = 3.333 → 3.33
    expect(chipsFromFiat('10.00', '0.3333')).toBe('3.33');
  });

  it('montos grandes sin perder precisión (BigInt, no float)', () => {
    expect(chipsFromFiat('1000000.00', '1000.0000')).toBe('1000000000.00');
  });
});

describe('ratio · fiatFromChips (plata = fichas ÷ ratio)', () => {
  it('ratio 1', () => {
    expect(fiatFromChips('5000.00', '1.0000')).toBe('5000.00');
  });

  it('ratio 1000: 10000 fichas → 10 USDT', () => {
    expect(fiatFromChips('10000.00', '1000.0000')).toBe('10.00');
  });

  it('inverso de chipsFromFiat (round-trip 1.5)', () => {
    expect(fiatFromChips('150.75', '1.5000')).toBe('100.50');
  });

  it('ratio 0 no rompe (devuelve 0)', () => {
    expect(fiatFromChips('100.00', '0')).toBe('0.00');
  });
});
