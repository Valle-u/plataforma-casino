/**
 * CLI: corre el simulador de Joker's Jewels y imprime resultados.
 *
 * Uso:
 *   pnpm --filter @casino/games-jokers-jewels simulate -- --spins 10000000
 *
 * Default: 1M spins (rápido, da idea, pero ±0.5% de error en RTP).
 * Para validación seria: 10M (toma ~30-60s, ±0.1%).
 */

import { formatSimulationResult } from '@casino/games-shared';
import { simulateJokersJewels } from '../simulator';

const args = process.argv.slice(2);
const spinsIdx = args.indexOf('--spins');
const spins = spinsIdx >= 0 ? Number(args[spinsIdx + 1]) : 1_000_000;

if (!Number.isInteger(spins) || spins <= 0) {
  console.error(`Spins inválido: ${spins}. Pasá --spins <entero positivo>`);
  process.exit(1);
}

console.log(`▶ Joker's Jewels — Monte Carlo simulation (${spins.toLocaleString('en-US')} spins)`);
console.log('  Target RTP: 96.50% ± 0.1%');
console.log('  Esto puede tomar 10-60s según el N...');
console.log('');

const result = simulateJokersJewels(spins, {
  onProgress: (done, total) => {
    const pct = ((done / total) * 100).toFixed(0);
    process.stdout.write(`\r  Progress: ${pct}% (${done.toLocaleString('en-US')}/${total.toLocaleString('en-US')})`);
  },
});
process.stdout.write('\r' + ' '.repeat(80) + '\r'); // clear progress line

console.log(formatSimulationResult(result));
console.log('');

// Validación del RTP target.
const TARGET_RTP = 0.965;
const TOLERANCE = 0.001; // ±0.1%
const delta = result.rtp - TARGET_RTP;
const absDelta = Math.abs(delta);

if (absDelta < TOLERANCE) {
  console.log(`✓ RTP dentro del target (delta: ${(delta * 100).toFixed(4)}%)`);
} else if (absDelta < 0.005) {
  console.log(`⚠ RTP cerca pero fuera del target (delta: ${(delta * 100).toFixed(4)}%)`);
  console.log('  Recomendación: correr 10M+ para reducir varianza estadística.');
} else {
  console.log(`✗ RTP FUERA del target (delta: ${(delta * 100).toFixed(4)}%)`);
  console.log('  Las reel strips NECESITAN calibración. Ver math.md §7 para dirección de ajuste.');
}
