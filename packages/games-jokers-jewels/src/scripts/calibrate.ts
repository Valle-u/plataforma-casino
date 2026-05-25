/**
 * Solver auto de calibración — Quality gate G1.6.4.
 *
 * Hace búsqueda dirigida sobre la frecuencia de jokers + crowns en
 * cada reel para llevar el RTP al target 96.50% ± 0.1%.
 *
 * Approach: greedy search local sobre swaps de pares de símbolos.
 * En cada iteración:
 *   1. Mide el RTP de la config actual con N spins.
 *   2. Si está dentro de tolerancia → done.
 *   3. Si RTP > target: probar todos los swaps "joker → gema baja"
 *      o "crown → gema baja" en cada reel. Aplicar el que más se
 *      acerca al target.
 *   4. Si RTP < target: lo opuesto ("gema → joker" o "gema → crown").
 *   5. Repetir hasta convergencia o máximo de iteraciones.
 *
 * Por qué greedy en vez de algo más fancy (gradient descent, simulated
 * annealing):
 *   - El espacio de búsqueda es discreto (cantidad de símbolos por
 *     reel) — no aplica gradient.
 *   - Para slots con math relativamente simple, greedy converge en
 *     20-50 iteraciones, cada una toma 5-15s con 500k spins.
 *   - Más fancy daría mejores resultados pero overkill para este juego.
 *
 * Uso:
 *   pnpm --filter @casino/games-jokers-jewels exec tsx \
 *     src/scripts/calibrate.ts -- --target-rtp 0.965 --tolerance 0.001
 *
 * Output: imprime cada iteración con su RTP. Al final, imprime el
 * REEL_STRIPS final como código TS listo para pegar en config.ts.
 */

import {
  computeRoundSeed,
  createDeterministicRng,
  runSimulation,
} from '@casino/games-shared';
import { REEL_STRIPS, type SymbolCode } from '../config';
// Nota: NO importamos `spin` del modulo principal porque acá usamos
// reel strips MUTABLES (no la const importada). El equivalente de spin()
// está inline en `spinWithLocalStrips` abajo.

const args = process.argv.slice(2);
function arg(flag: string, def: number): number {
  const idx = args.indexOf(flag);
  if (idx < 0) return def;
  const v = Number(args[idx + 1]);
  if (!Number.isFinite(v)) {
    console.error(`Valor inválido para ${flag}: ${args[idx + 1]}`);
    process.exit(1);
  }
  return v;
}

const TARGET_RTP = arg('--target-rtp', 0.965);
const TOLERANCE = arg('--tolerance', 0.001);
const SPINS_PER_ITERATION = arg('--spins', 500_000);
const MAX_ITERATIONS = arg('--max-iter', 40);

console.log(`▶ Joker's Jewels — auto-calibrator`);
console.log(`  Target RTP:    ${(TARGET_RTP * 100).toFixed(2)}% ± ${(TOLERANCE * 100).toFixed(2)}%`);
console.log(`  Spins/iter:    ${SPINS_PER_ITERATION.toLocaleString('en-US')}`);
console.log(`  Max iters:     ${MAX_ITERATIONS}`);
console.log('');

// Trabajamos sobre una copia mutable de las reel strips.
const strips: SymbolCode[][] = REEL_STRIPS.map((r) => [...r]);
const SERVER_SEED = Buffer.alloc(32, 0x42);
const CLIENT_SEED = 'calibrator';

/**
 * Mide RTP sobre `spins` con las strips actuales.
 * NO usamos REEL_STRIPS importadas directo porque queremos mutar —
 * mockeamos via override del config sería más limpio pero requiere
 * refactor del spin. Por ahora: ejecutamos spin con un "fake spin"
 * que usa nuestras strips locales.
 */
function measureRtp(): number {
  const result = runSimulation(
    (index) => {
      const roundSeed = computeRoundSeed(SERVER_SEED, CLIENT_SEED, index);
      const rng = createDeterministicRng(roundSeed);
      return spinWithLocalStrips(rng);
    },
    SPINS_PER_ITERATION,
  );
  return result.rtp;
}

/**
 * Versión local del spin que usa nuestras strips mutables en vez de
 * la constante REEL_STRIPS del config. Misma lógica que spin() pero
 * inyectable.
 */
function spinWithLocalStrips(rng: ReturnType<typeof createDeterministicRng>): number {
  // Replicamos la lógica de spin() pero con `strips` local.
  const board: SymbolCode[][] = [];
  for (let r = 0; r < 5; r++) {
    const strip = strips[r]!;
    const stop = rng.nextInt(strip.length);
    const reelVisible: SymbolCode[] = [];
    for (let row = 0; row < 3; row++) {
      reelVisible.push(strip[(stop + row) % strip.length]!);
    }
    board.push(reelVisible);
  }
  // Inyectamos board directamente al spin via un RNG dummy y pisamos
  // luego. Más simple: re-evaluamos las paylines acá.
  return evaluateInline(board);
}

const PAYLINES: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [0, 0, 0, 0, 0],
  [1, 1, 1, 1, 1],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
];

const PAYTABLE: Record<SymbolCode, Record<3 | 4 | 5, number>> = {
  joker: { 3: 4, 4: 40, 5: 200 },
  crown: { 3: 2, 4: 10, 5: 50 },
  mandolin: { 3: 2, 4: 8, 5: 40 },
  boots: { 3: 2, 4: 8, 5: 40 },
  diamond_pink: { 3: 0.4, 4: 2, 5: 8 },
  ruby: { 3: 0.4, 4: 2, 5: 8 },
  sapphire: { 3: 0.4, 4: 2, 5: 8 },
  emerald: { 3: 0.4, 4: 2, 5: 8 },
};

function evaluateInline(board: SymbolCode[][]): number {
  let total = 0;
  for (const payline of PAYLINES) {
    const line = payline.map((row, r) => board[r]![row]!);
    let base: SymbolCode = 'joker';
    for (const s of line) {
      if (s !== 'joker') {
        base = s;
        break;
      }
    }
    let count = 0;
    for (const s of line) {
      if (s === base || s === 'joker') count++;
      else break;
    }
    if (count >= 3) {
      const multiplier = PAYTABLE[base][count as 3 | 4 | 5];
      total += multiplier * (1 / 5); // bet=1, dividido entre 5 líneas
    }
  }
  return total;
}

// ── Algoritmo greedy ──
// Symbols ordenados por contribución al RTP (de alta a baja):
// joker > crown > mandolin/boots > gemas
const HIGH_CONTRIB: SymbolCode[] = ['joker', 'crown'];
const LOW_CONTRIB: SymbolCode[] = ['emerald', 'sapphire', 'ruby', 'diamond_pink'];

interface SwapCandidate {
  reelIndex: number;
  from: SymbolCode;
  to: SymbolCode;
  symbolToSwap: number; // índice dentro del reel
}

function listSwapCandidates(direction: 'up' | 'down'): SwapCandidate[] {
  const candidates: SwapCandidate[] = [];
  for (let r = 0; r < 5; r++) {
    const strip = strips[r]!;
    for (let i = 0; i < strip.length; i++) {
      const s = strip[i]!;
      if (direction === 'up') {
        // Reemplazar una gema por un símbolo high-contrib.
        if (LOW_CONTRIB.includes(s)) {
          for (const target of HIGH_CONTRIB) {
            candidates.push({ reelIndex: r, from: s, to: target, symbolToSwap: i });
          }
        }
      } else {
        // Reemplazar un símbolo high-contrib por una gema.
        if (HIGH_CONTRIB.includes(s)) {
          for (const target of LOW_CONTRIB) {
            candidates.push({ reelIndex: r, from: s, to: target, symbolToSwap: i });
          }
        }
      }
    }
  }
  return candidates;
}

function applySwap(swap: SwapCandidate): void {
  strips[swap.reelIndex]![swap.symbolToSwap] = swap.to;
}

function revertSwap(swap: SwapCandidate): void {
  strips[swap.reelIndex]![swap.symbolToSwap] = swap.from;
}

// ── Loop principal ──
const initialRtp = measureRtp();
console.log(`Iter 0 (inicial): RTP = ${(initialRtp * 100).toFixed(4)}%`);
console.log('');

for (let iter = 1; iter <= MAX_ITERATIONS; iter++) {
  const currentRtp = measureRtp();
  const gap = currentRtp - TARGET_RTP;

  if (Math.abs(gap) < TOLERANCE) {
    console.log(`✓ CONVERGIDO en iter ${iter - 1}: RTP = ${(currentRtp * 100).toFixed(4)}%`);
    break;
  }

  const direction = gap > 0 ? 'down' : 'up';
  const candidates = listSwapCandidates(direction);

  // En vez de probar TODOS los swaps (sería lento), sampleamos N
  // candidatos al azar y nos quedamos con el mejor.
  const SAMPLE_SIZE = Math.min(20, candidates.length);
  const sampled: SwapCandidate[] = [];
  const indices = new Set<number>();
  while (indices.size < SAMPLE_SIZE) {
    indices.add(Math.floor(Math.random() * candidates.length));
  }
  for (const idx of indices) sampled.push(candidates[idx]!);

  let bestSwap: SwapCandidate | null = null;
  let bestDelta = Infinity;

  for (const swap of sampled) {
    applySwap(swap);
    const newRtp = measureRtp();
    const newGap = Math.abs(newRtp - TARGET_RTP);
    if (newGap < bestDelta) {
      bestDelta = newGap;
      bestSwap = swap;
    }
    revertSwap(swap);
  }

  if (!bestSwap) {
    console.log(`Iter ${iter}: no se encontraron swaps candidatos. Stop.`);
    break;
  }

  applySwap(bestSwap);
  const newRtp = measureRtp();
  console.log(
    `Iter ${iter}: RTP ${(currentRtp * 100).toFixed(4)}% → ${(newRtp * 100).toFixed(4)}% ` +
      `(swap reel ${bestSwap.reelIndex + 1} pos ${bestSwap.symbolToSwap}: ${bestSwap.from} → ${bestSwap.to})`,
  );

  if (Math.abs(newRtp - TARGET_RTP) < TOLERANCE) {
    console.log('');
    console.log(`✓ CONVERGIDO: RTP = ${(newRtp * 100).toFixed(4)}%`);
    break;
  }
}

// ── Output final ──
console.log('');
console.log('═══════════════════════════════════════════════════════');
console.log('  REEL STRIPS FINAL (copiá a config.ts)');
console.log('═══════════════════════════════════════════════════════');
console.log('');
for (let r = 0; r < strips.length; r++) {
  console.log(`  // Reel ${r + 1}`);
  console.log(`  [`);
  const strip = strips[r]!;
  for (let i = 0; i < strip.length; i += 8) {
    const line = strip.slice(i, i + 8).map((s) => `'${s}'`).join(', ');
    console.log(`    ${line},`);
  }
  console.log(`  ],`);
}
console.log('');

// Resumen de composición.
const composition: Record<SymbolCode, number[]> = {
  joker: [], crown: [], mandolin: [], boots: [],
  diamond_pink: [], ruby: [], sapphire: [], emerald: [],
};
for (const strip of strips) {
  for (const key of Object.keys(composition) as SymbolCode[]) {
    composition[key].push(strip.filter((s) => s === key).length);
  }
}
console.log('  Composición final:');
for (const [sym, counts] of Object.entries(composition)) {
  console.log(`    ${sym.padEnd(14)} ${counts.join(' | ')}`);
}
