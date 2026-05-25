/**
 * Monte Carlo runner — helper genérico para validar math de juegos propios.
 *
 * Cada juego implementa una función `spin(rng) → number` (el payout)
 * y este helper la corre N veces, midiendo:
 *   - RTP empírico (sum(wins) / N × bet)
 *   - Hit frequency (% spins con win > 0)
 *   - Distribución de payouts (top buckets)
 *   - Max win observado
 *   - Tiempo de ejecución
 *
 * Performance:
 *   - Pensado para correr 10M+ spins en CI / dev. Single-threaded.
 *   - Para 10M spins de Joker's Jewels esperamos ~30-60s en una laptop.
 *   - Si emerge necesidad, optimizar via worker_threads (cada worker
 *     corre 1M spins, el main agrega resultados).
 */

import { performance } from 'perf_hooks';

export interface SimulationResult {
  /** Cantidad total de spins ejecutados. */
  spins: number;
  /** Suma de todos los wins (en unidades de bet). */
  totalWin: number;
  /** Bet total (siempre `spins × 1.0` en la simulación normalizada). */
  totalBet: number;
  /** RTP empírico = totalWin / totalBet. Compará con el target del juego. */
  rtp: number;
  /** Cantidad de spins con win > 0. */
  hits: number;
  /** Hit frequency = hits / spins. */
  hitFrequency: number;
  /** Max win individual observado en cualquier spin (en unidades de bet). */
  maxWin: number;
  /**
   * Standard deviation del payout — proxy de volatility del juego.
   *
   * Heurística para slots:
   *   - stddev < 1.5 × rtp → low volatility (wins frecuentes pequeños)
   *   - stddev entre 1.5-5 × rtp → medium volatility
   *   - stddev > 5 × rtp → high volatility (premios grandes raros)
   *
   * El juego original de Joker's Jewels (Pragmatic) declara volatility
   * media (4/5 en escala Pragmatic). Esperamos stddev en ~2-3× RTP.
   */
  stddev: number;
  /**
   * Distribución de payouts agrupada en buckets logarítmicos.
   * Útil para detectar volatility: pocos buckets altos = high vol,
   * muchos buckets bajos = low vol.
   *
   * Key = "0", "(0, 1]", "(1, 5]", "(5, 25]", "(25, 100]",
   *       "(100, 1000]", "> 1000".
   * Value = % de spins en ese bucket.
   */
  distribution: Record<string, number>;
  /** Milisegundos totales de ejecución. */
  elapsedMs: number;
  /** Spins por segundo (throughput). */
  spinsPerSecond: number;
}

const BUCKETS: Array<{ label: string; max: number }> = [
  { label: '0 (no win)', max: 0 },
  { label: '(0, 1]', max: 1 },
  { label: '(1, 5]', max: 5 },
  { label: '(5, 25]', max: 25 },
  { label: '(25, 100]', max: 100 },
  { label: '(100, 1000]', max: 1000 },
  { label: '> 1000', max: Infinity },
];

/**
 * Corre la simulación. `spinFn(i)` debe devolver el payout del spin
 * número `i` (con bet normalizado a 1.0). El index puede usarse como
 * nonce para provably fair determinístico.
 *
 * `onProgress` se llama cada `progressEvery` spins con el conteo —
 * útil para imprimir progress en simulaciones largas.
 */
export function runSimulation(
  spinFn: (index: number) => number,
  spins: number,
  options: {
    progressEvery?: number;
    onProgress?: (done: number, totalSpins: number) => void;
  } = {},
): SimulationResult {
  const { progressEvery = 1_000_000, onProgress } = options;

  let totalWin = 0;
  let hits = 0;
  let maxWin = 0;
  // Para calcular standard deviation usamos Welford's online algorithm:
  // mantiene mean y sum-of-squared-deltas sin almacenar todos los wins
  // (lo que sería 80MB para 10M spins). Numéricamente estable también.
  let welfordMean = 0;
  let welfordM2 = 0;
  const bucketCounts = new Array<number>(BUCKETS.length).fill(0);

  const startedAt = performance.now();

  for (let i = 0; i < spins; i++) {
    const win = spinFn(i);
    totalWin += win;
    if (win > 0) hits++;
    if (win > maxWin) maxWin = win;

    // Welford update.
    const delta = win - welfordMean;
    welfordMean += delta / (i + 1);
    const delta2 = win - welfordMean;
    welfordM2 += delta * delta2;

    // Asignar bucket. Búsqueda lineal — son 7 buckets, no vale la pena
    // binary search.
    for (let b = 0; b < BUCKETS.length; b++) {
      const bucket = BUCKETS[b]!;
      const prev = b === 0 ? -Infinity : BUCKETS[b - 1]!.max;
      if (win > prev && win <= bucket.max) {
        bucketCounts[b]!++;
        break;
      }
    }
    if (onProgress && (i + 1) % progressEvery === 0) {
      onProgress(i + 1, spins);
    }
  }

  const elapsedMs = performance.now() - startedAt;

  const distribution: Record<string, number> = {};
  for (let b = 0; b < BUCKETS.length; b++) {
    distribution[BUCKETS[b]!.label] = bucketCounts[b]! / spins;
  }

  // Variance = M2 / N (population) o M2 / (N-1) (sample). Para
  // Monte Carlo grande la diferencia es despreciable; usamos sample
  // (N-1) por convención estadística.
  const variance = spins > 1 ? welfordM2 / (spins - 1) : 0;
  const stddev = Math.sqrt(variance);

  return {
    spins,
    totalWin,
    totalBet: spins, // normalizado: 1 unidad de bet por spin
    rtp: totalWin / spins,
    hits,
    hitFrequency: hits / spins,
    maxWin,
    stddev,
    distribution,
    elapsedMs,
    spinsPerSecond: spins / (elapsedMs / 1000),
  };
}

/**
 * Formatea un SimulationResult como string legible. Útil para imprimir
 * resultados en CLI sin tener que escribir un formatter por juego.
 */
export function formatSimulationResult(r: SimulationResult): string {
  const lines: string[] = [];
  lines.push('═══════════════════════════════════════════════════════');
  lines.push('  Monte Carlo Simulation Result');
  lines.push('═══════════════════════════════════════════════════════');
  lines.push(`  Spins:           ${r.spins.toLocaleString('en-US')}`);
  lines.push(`  Elapsed:         ${(r.elapsedMs / 1000).toFixed(2)}s`);
  lines.push(`  Throughput:      ${Math.round(r.spinsPerSecond).toLocaleString('en-US')} spins/s`);
  lines.push('');
  lines.push(`  RTP empírico:    ${(r.rtp * 100).toFixed(4)}%`);
  lines.push(`  Hit frequency:   ${(r.hitFrequency * 100).toFixed(2)}%`);
  lines.push(`  Max win:         ${r.maxWin.toFixed(2)}× bet`);
  lines.push(`  Stddev payout:   ${r.stddev.toFixed(3)} (volatility proxy)`);
  lines.push('');
  lines.push('  Distribución de payouts:');
  for (const [label, pct] of Object.entries(r.distribution)) {
    const bar = '█'.repeat(Math.round(pct * 50));
    lines.push(`    ${label.padEnd(15)} ${(pct * 100).toFixed(3)}%  ${bar}`);
  }
  lines.push('═══════════════════════════════════════════════════════');
  return lines.join('\n');
}
