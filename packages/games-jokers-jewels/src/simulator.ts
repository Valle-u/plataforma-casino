/**
 * Simulador Monte Carlo para Joker's Jewels.
 *
 * Wrapper sobre `runSimulation` de games-shared que arma el `spinFn`
 * específico del slot:
 *   - Genera un serverSeed fijo (no es relevante para el RTP, solo
 *     necesitamos consistencia entre runs de la simulación).
 *   - Usa el índice del loop como nonce.
 *   - Cada spin: computeRoundSeed → createDeterministicRng → spin().
 *
 * Uso típico:
 *
 *   import { simulateJokersJewels } from '@casino/games-jokers-jewels';
 *   const r = simulateJokersJewels(10_000_000);
 *   console.log(r.rtp); // → 0.965 si está calibrado
 */

import {
  computeRoundSeed,
  createDeterministicRng,
  runSimulation,
  type SimulationResult,
} from '@casino/games-shared';
import { spin } from './spin';

/**
 * Corre N spins de Joker's Jewels con bet = 1 chip y devuelve las
 * estadísticas. El RTP empírico debe converger a 96.50% ± 0.1% sobre
 * 10M+ spins si las reel strips están calibradas.
 *
 * `serverSeed` es opcional — default un valor fijo de 32 bytes para
 * que las corridas sean reproducibles. Para variar las corridas pasar
 * un Buffer distinto.
 */
export function simulateJokersJewels(
  spins: number,
  options: {
    serverSeed?: Buffer;
    clientSeed?: string;
    onProgress?: (done: number, total: number) => void;
  } = {},
): SimulationResult {
  const serverSeed = options.serverSeed ?? Buffer.alloc(32, 0x42);
  const clientSeed = options.clientSeed ?? 'simulator-default-client';

  return runSimulation(
    (index) => {
      const roundSeed = computeRoundSeed(serverSeed, clientSeed, index);
      const rng = createDeterministicRng(roundSeed);
      const result = spin(rng, 1);
      return result.totalWin;
    },
    spins,
    { onProgress: options.onProgress },
  );
}
