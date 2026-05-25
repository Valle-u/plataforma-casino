/**
 * Reproducibility end-to-end test — Quality gate G1.4.4.
 *
 * Genera 1000 spins guardando (serverSeed, clientSeed, nonce, outcome).
 * Re-genera los 1000 spins desde los mismos seeds y valida que cada
 * outcome matchea byte-by-byte.
 *
 * Esto es la garantía CORE del provably fair: cualquier round del
 * pasado debe poder recrearse exactamente desde sus seeds. Si esto
 * falla, ningún jugador puede verificar fairness y todo el sistema
 * de provably fair queda comprometido.
 */

import { describe, it, expect } from 'vitest';
import { randomBytes } from 'crypto';
import {
  computeRoundSeed,
  createDeterministicRng,
  newServerSeed,
  newClientSeedDefault,
} from '@casino/games-shared';
import { spin } from './spin';

interface RecordedRound {
  serverSeedHex: string;
  clientSeed: string;
  nonce: number;
  outcome: {
    reelStops: number[];
    boardFlat: string[]; // serializado para comparación fácil
    totalWin: number;
  };
}

function executeRound(
  serverSeed: Buffer,
  clientSeed: string,
  nonce: number,
  bet: number,
): RecordedRound['outcome'] {
  const roundSeed = computeRoundSeed(serverSeed, clientSeed, nonce);
  const rng = createDeterministicRng(roundSeed);
  const result = spin(rng, bet);
  return {
    reelStops: [...result.reelStops],
    boardFlat: result.board.flatMap((reel) => [...reel]),
    totalWin: result.totalWin,
  };
}

describe('reproducibility end-to-end', () => {
  it('1000 rounds son reproducibles desde seeds (mismo serverSeed/clientSeed/nonce)', () => {
    // ── Fase 1: generar 1000 rounds y grabar sus seeds + outcomes ──
    const { seed: serverSeed } = newServerSeed();
    const clientSeed = newClientSeedDefault();
    const recorded: RecordedRound[] = [];

    for (let nonce = 0; nonce < 1000; nonce++) {
      const outcome = executeRound(serverSeed, clientSeed, nonce, 1);
      recorded.push({
        serverSeedHex: serverSeed.toString('hex'),
        clientSeed,
        nonce,
        outcome,
      });
    }

    // ── Fase 2: simular que el server revela el serverSeed al jugador y
    //           el jugador re-ejecuta los 1000 rounds desde cero ──
    const replayedServerSeed = Buffer.from(recorded[0]!.serverSeedHex, 'hex');
    expect(replayedServerSeed.equals(serverSeed)).toBe(true);

    for (const rec of recorded) {
      const replayed = executeRound(
        replayedServerSeed,
        rec.clientSeed,
        rec.nonce,
        1,
      );
      // Validación byte-by-byte de los 3 campos críticos del outcome.
      expect(replayed.reelStops).toEqual(rec.outcome.reelStops);
      expect(replayed.boardFlat).toEqual(rec.outcome.boardFlat);
      expect(replayed.totalWin).toBe(rec.outcome.totalWin);
    }
  });

  it('cambio mínimo en clientSeed produce outcomes distintos', () => {
    // Si el clientSeed cambia (incluso 1 char), la secuencia de outcomes
    // debe cambiar. Sino el provably fair no aporta nada.
    const serverSeed = randomBytes(32);
    const N = 100;

    const a: RecordedRound['outcome'][] = [];
    const b: RecordedRound['outcome'][] = [];
    for (let nonce = 0; nonce < N; nonce++) {
      a.push(executeRound(serverSeed, 'cliente_a', nonce, 1));
      b.push(executeRound(serverSeed, 'cliente_b', nonce, 1));
    }

    // Esperamos que al menos 80% de los rounds tengan reelStops distintos
    // (algunos pueden colisionar por casualidad — son 32^5 posibilidades).
    let distintos = 0;
    for (let i = 0; i < N; i++) {
      const sameStops = a[i]!.reelStops.every(
        (s, idx) => s === b[i]!.reelStops[idx],
      );
      if (!sameStops) distintos++;
    }
    expect(distintos).toBeGreaterThan(N * 0.8);
  });

  it('cambio en nonce produce outcomes distintos para mismo seed', () => {
    // Si el nonce no se incrementa, todos los spins serían iguales.
    // Validamos que cada nonce produce su outcome único.
    const serverSeed = randomBytes(32);
    const clientSeed = 'fixed_client';

    const outcomes: number[][] = [];
    for (let nonce = 0; nonce < 20; nonce++) {
      const r = executeRound(serverSeed, clientSeed, nonce, 1);
      outcomes.push(r.reelStops);
    }

    // Contar cuántos pares de nonces consecutivos tienen reelStops idénticos.
    // Es estadísticamente improbable que muchos colisionen.
    let collisions = 0;
    for (let i = 1; i < outcomes.length; i++) {
      const same = outcomes[i]!.every(
        (s, idx) => s === outcomes[i - 1]![idx],
      );
      if (same) collisions++;
    }
    expect(collisions).toBeLessThan(2); // a lo sumo 1 colisión casual en 20 nonces
  });

  it('reproducibilidad funciona con bet decimal — los outcomes son idénticos', () => {
    // Edge case: si el bet decimal introduce algún imprecisión float que
    // hace los outcomes no reproducibles, lo detectamos acá.
    const serverSeed = randomBytes(32);
    const clientSeed = 'decimal_test';

    for (const bet of [0.01, 0.1, 1.7777, 100, 999.99]) {
      const a = executeRound(serverSeed, clientSeed, 0, bet);
      const b = executeRound(serverSeed, clientSeed, 0, bet);
      expect(a).toEqual(b);
    }
  });
});
