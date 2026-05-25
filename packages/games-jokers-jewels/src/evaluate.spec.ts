/**
 * Tests de evaluación de paylines — pruebas con boards hand-crafted
 * para validar que las reglas de wild + run consecutivo funcionan.
 */

import { describe, it, expect } from 'vitest';
import { evaluatePaylines, type Board } from './evaluate';

// Helper para armar boards legibles. Cada string es un reel de 3 símbolos.
// Notación: 'J'=joker, 'C'=crown, 'M'=mandolin, 'B'=boots,
//           'P'=diamond_pink, 'R'=ruby, 'S'=sapphire, 'E'=emerald.
function board(...reels: string[]): Board {
  const map: Record<string, string> = {
    J: 'joker', C: 'crown', M: 'mandolin', B: 'boots',
    P: 'diamond_pink', R: 'ruby', S: 'sapphire', E: 'emerald',
  };
  return reels.map((r) => r.split('').map((c) => map[c] as 'joker'));
}

describe('evaluatePaylines', () => {
  it('board sin matches devuelve 0 wins', () => {
    // Layout cuidadoso: ninguna payline (incluidas las 2 Vs) tiene
    // 3+ del mismo símbolo consecutivo desde la izquierda.
    const b = board('CMR', 'SEP', 'BRM', 'ESP', 'MRC');
    const wins = evaluatePaylines(b, 1);
    expect(wins).toEqual([]);
  });

  it('3 corona consecutivos en línea top paga 2× bet/línea', () => {
    // Top row = [C, C, C, ?, ?] — 3 coronas consecutivas desde la izq.
    const b = board('CRM', 'CMR', 'CRM', 'RMR', 'MCR');
    const wins = evaluatePaylines(b, 5); // bet 5 → 1 por línea
    expect(wins.length).toBeGreaterThanOrEqual(1);
    const top = wins.find((w) => w.paylineIndex === 0);
    expect(top).toBeDefined();
    expect(top!.symbol).toBe('crown');
    expect(top!.count).toBe(3);
    expect(top!.multiplier).toBe(2);
    expect(top!.win).toBe(2 * 1); // 2× × bet/línea (1)
  });

  it('5 joker consecutivos paga 200× (top tier)', () => {
    const b = board('JCM', 'JMR', 'JRM', 'JMR', 'JCM');
    const wins = evaluatePaylines(b, 5);
    const top = wins.find((w) => w.paylineIndex === 0);
    expect(top).toBeDefined();
    expect(top!.symbol).toBe('joker');
    expect(top!.count).toBe(5);
    expect(top!.multiplier).toBe(200);
    expect(top!.win).toBe(200);
  });

  it('joker actúa como wild — completa una línea de corona', () => {
    // Top row = [C, J, C, C, C] — el joker actúa como corona, 5 coronas.
    const b = board('CRM', 'JMR', 'CRM', 'CMR', 'CMR');
    const wins = evaluatePaylines(b, 5);
    const top = wins.find((w) => w.paylineIndex === 0);
    expect(top).toBeDefined();
    expect(top!.symbol).toBe('crown');
    expect(top!.count).toBe(5);
    expect(top!.multiplier).toBe(50);
  });

  it('joker al inicio toma el símbolo del primer no-joker', () => {
    // Top row = [J, C, C, R, ?] — joker se vuelve corona, count=3.
    const b = board('JRM', 'CMR', 'CRM', 'RMR', 'MCM');
    const wins = evaluatePaylines(b, 5);
    const top = wins.find((w) => w.paylineIndex === 0);
    expect(top).toBeDefined();
    expect(top!.symbol).toBe('crown');
    expect(top!.count).toBe(3);
  });

  it('un break en el medio frena el run', () => {
    // Top row = [C, C, R, C, C] — 2 coronas + break → NO paga (mín 3).
    const b = board('CRM', 'CMR', 'RMR', 'CRM', 'CMR');
    const wins = evaluatePaylines(b, 5);
    const top = wins.find((w) => w.paylineIndex === 0);
    expect(top).toBeUndefined();
  });

  it('múltiples paylines pueden ganar en el mismo spin', () => {
    // Diseñamos un board donde la top Y la middle ambas dan 3 corona.
    // Top: [C, C, C, R, M]
    // Mid: [C, C, C, M, R]
    const b = board('CCM', 'CCR', 'CCR', 'RMR', 'MRM');
    const wins = evaluatePaylines(b, 5);
    expect(wins.length).toBeGreaterThanOrEqual(2);
    const top = wins.find((w) => w.paylineIndex === 0);
    const mid = wins.find((w) => w.paylineIndex === 1);
    expect(top).toBeDefined();
    expect(mid).toBeDefined();
  });

  it('V invertida (L4) detecta correctamente sus 5 celdas', () => {
    // L4 toca: reel1[0], reel2[1], reel3[2], reel4[1], reel5[0].
    // Ponemos ruby en esas 5 posiciones; el resto de cada reel con
    // sapphire para que no choque con otras paylines.
    // Notación: 'R'=ruby, 'S'=sapphire.
    const b = board(
      'RSS', // reel1: top=ruby
      'SRS', // reel2: mid=ruby
      'SSR', // reel3: bot=ruby
      'SRS', // reel4: mid=ruby
      'RSS', // reel5: top=ruby
    );
    const wins = evaluatePaylines(b, 5);
    const v = wins.find((w) => w.paylineIndex === 3);
    expect(v).toBeDefined();
    expect(v!.symbol).toBe('ruby');
    expect(v!.count).toBe(5);
  });

  it('error si el board no tiene 5 reels', () => {
    const bad = board('CRM', 'CMR'); // solo 2 reels
    expect(() => evaluatePaylines(bad, 5)).toThrow();
  });
});
