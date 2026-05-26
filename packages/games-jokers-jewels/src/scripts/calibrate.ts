/**
 * Solver auto de calibración v2 — Sprint 1.6.
 *
 * Mejoras vs v1 (Sprint 1.5):
 *   - Spins por iteración: 300k → **2M** (variance estadística ~±0.05%
 *     vs ±0.3% antes). Cada movimiento que el solver evalúa es 6× más
 *     confiable.
 *   - Algoritmo: greedy → **simulated annealing**. Acepta moves
 *     temporalmente peores con probabilidad e^(-Δ/T), donde T (la
 *     "temperatura") arranca alta y decae. Esto escapa local minima
 *     donde greedy se atasca.
 *   - **Validación intermedia**: cuando el solver cree haber llegado al
 *     target, valida con 10M antes de aceptar (catch del falso positivo
 *     que rompió v1).
 *
 * Tiempo esperado: ~50-100 iteraciones × ~20s/iter = 15-35 min. La
 * validación intermedia agrega ~90s al cierre.
 *
 * Uso:
 *   pnpm --filter @casino/games-jokers-jewels exec tsx \
 *     src/scripts/calibrate.ts --target-rtp 0.965 --tolerance 0.001
 */

import {
  computeRoundSeed,
  createDeterministicRng,
  runSimulation,
} from '@casino/games-shared';
import { REEL_STRIPS, type SymbolCode } from '../config';

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
const SPINS_PER_ITER = arg('--spins', 2_000_000);
const VALIDATION_SPINS = arg('--validate-spins', 10_000_000);
const MAX_ITERATIONS = arg('--max-iter', 80);
// Parámetros de simulated annealing
const INITIAL_TEMP = arg('--initial-temp', 0.005); // probabilidad inicial de aceptar +0.5% peor
const COOLING_RATE = arg('--cooling-rate', 0.95); // temp[i+1] = temp[i] × 0.95

console.log(`▶ Joker's Jewels — auto-calibrator v2 (Sprint 1.6)`);
console.log(`  Target RTP:     ${(TARGET_RTP * 100).toFixed(2)}% ± ${(TOLERANCE * 100).toFixed(2)}%`);
console.log(`  Spins/iter:     ${SPINS_PER_ITER.toLocaleString('en-US')}`);
console.log(`  Validate spins: ${VALIDATION_SPINS.toLocaleString('en-US')}`);
console.log(`  Max iters:      ${MAX_ITERATIONS}`);
console.log(`  Temp inicial:   ${INITIAL_TEMP} (decay ${COOLING_RATE}/iter)`);
console.log('');

// Trabajamos sobre una copia mutable de las reel strips.
const strips: SymbolCode[][] = REEL_STRIPS.map((r) => [...r]);
const SERVER_SEED = Buffer.alloc(32, 0x42);
const CLIENT_SEED = 'calibrator-v2';

// ── Spin inline (idéntico a spin() pero con strips local) ──
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
  bolos: { 3: 0.4, 4: 2, 5: 8 },
  ruby: { 3: 0.4, 4: 2, 5: 8 },
  sapphire: { 3: 0.4, 4: 2, 5: 8 },
  emerald: { 3: 0.4, 4: 2, 5: 8 },
};

function spinInline(rng: ReturnType<typeof createDeterministicRng>): number {
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
      total += PAYTABLE[base][count as 3 | 4 | 5] * 0.2;
    }
  }
  return total;
}

function measureRtp(spins: number): number {
  const result = runSimulation(
    (index) => {
      const roundSeed = computeRoundSeed(SERVER_SEED, CLIENT_SEED, index);
      const rng = createDeterministicRng(roundSeed);
      return spinInline(rng);
    },
    spins,
  );
  return result.rtp;
}

// ── Generación de candidatos: swaps de pares de símbolos ──
const HIGH_CONTRIB: SymbolCode[] = ['joker', 'crown'];
const LOW_CONTRIB: SymbolCode[] = ['emerald', 'sapphire', 'ruby', 'bolos'];

interface SwapCandidate {
  reelIndex: number;
  from: SymbolCode;
  to: SymbolCode;
  position: number;
}

/**
 * Genera un swap random. Si el RTP actual está ABAJO del target,
 * prefiere swaps que suban (low → high). Si está ARRIBA, baja (high → low).
 * Pero a veces (con probabilidad de annealing) sortea el opuesto para
 * escapar local minima.
 */
function randomSwap(direction: 'up' | 'down'): SwapCandidate | null {
  const fromCategory = direction === 'up' ? LOW_CONTRIB : HIGH_CONTRIB;
  const toCategory = direction === 'up' ? HIGH_CONTRIB : LOW_CONTRIB;

  // Sampleamos un reel y posición random, retry hasta 50 veces si no
  // encontramos un símbolo de la categoría que queremos cambiar.
  for (let attempt = 0; attempt < 50; attempt++) {
    const r = Math.floor(Math.random() * 5);
    const strip = strips[r]!;
    const pos = Math.floor(Math.random() * strip.length);
    const current = strip[pos]!;
    if (fromCategory.includes(current)) {
      const to = toCategory[Math.floor(Math.random() * toCategory.length)]!;
      return { reelIndex: r, from: current, to, position: pos };
    }
  }
  return null;
}

function applySwap(s: SwapCandidate): void {
  strips[s.reelIndex]![s.position] = s.to;
}
function revertSwap(s: SwapCandidate): void {
  strips[s.reelIndex]![s.position] = s.from;
}

// ── Simulated annealing loop ──
const initialRtp = measureRtp(SPINS_PER_ITER);
console.log(`Iter 0: RTP = ${(initialRtp * 100).toFixed(4)}% (inicial, ${SPINS_PER_ITER.toLocaleString('en-US')} spins)`);
console.log('');

let currentRtp = initialRtp;
let bestRtp = currentRtp;
let bestStripsSnapshot: SymbolCode[][] = strips.map((r) => [...r]);
let temperature = INITIAL_TEMP;
let convergedAt = -1;

for (let iter = 1; iter <= MAX_ITERATIONS; iter++) {
  // Direction sigue lo que necesitamos para llegar al target. Pero
  // simulated annealing a veces sortea el opuesto para escapar local mins.
  const naturalDirection: 'up' | 'down' = currentRtp < TARGET_RTP ? 'up' : 'down';
  const direction: 'up' | 'down' =
    Math.random() < 0.85 ? naturalDirection : naturalDirection === 'up' ? 'down' : 'up';

  const swap = randomSwap(direction);
  if (!swap) {
    console.log(`Iter ${iter}: no se pudieron generar swaps (${direction}). Skip.`);
    continue;
  }

  applySwap(swap);
  const newRtp = measureRtp(SPINS_PER_ITER);
  const newGap = Math.abs(newRtp - TARGET_RTP);
  const oldGap = Math.abs(currentRtp - TARGET_RTP);
  const improvement = oldGap - newGap; // positivo = mejora

  // Aceptación: siempre si mejora; si empeora, con prob e^(-empeora/T).
  let accept: boolean;
  if (improvement >= 0) {
    accept = true;
  } else {
    const probAccept = Math.exp(improvement / temperature);
    accept = Math.random() < probAccept;
  }

  if (accept) {
    currentRtp = newRtp;
    if (Math.abs(newRtp - TARGET_RTP) < Math.abs(bestRtp - TARGET_RTP)) {
      bestRtp = newRtp;
      bestStripsSnapshot = strips.map((r) => [...r]);
    }
    console.log(
      `Iter ${iter}: ${(currentRtp * 100).toFixed(4)}% ` +
        `(swap r${swap.reelIndex + 1}.${swap.position}: ${swap.from}→${swap.to}, ` +
        `${improvement >= 0 ? '↑' : '↓'} ${(Math.abs(improvement) * 100).toFixed(4)}%, T=${temperature.toFixed(4)})`,
    );
  } else {
    revertSwap(swap);
    console.log(
      `Iter ${iter}: rechazado swap ${swap.from}→${swap.to} (RTP ${(newRtp * 100).toFixed(4)}%, prob accept=${Math.exp(improvement / temperature).toFixed(4)})`,
    );
  }

  // Cooling
  temperature *= COOLING_RATE;

  // Convergence check: si el best está dentro del target tolerance,
  // validar con N grande antes de declarar done.
  if (Math.abs(bestRtp - TARGET_RTP) < TOLERANCE) {
    console.log('');
    console.log(`🔍 Mejor candidato dentro de tolerancia. Validando con ${VALIDATION_SPINS.toLocaleString('en-US')} spins...`);
    // Aplicamos best y medimos.
    const savedStrips = strips.map((r) => [...r]);
    for (let r = 0; r < 5; r++) strips[r] = [...bestStripsSnapshot[r]!];
    const validatedRtp = measureRtp(VALIDATION_SPINS);
    console.log(`  Validación: RTP = ${(validatedRtp * 100).toFixed(4)}%`);
    if (Math.abs(validatedRtp - TARGET_RTP) < TOLERANCE) {
      console.log(`✓ CONVERGIDO real en iter ${iter}: RTP = ${(validatedRtp * 100).toFixed(4)}%`);
      convergedAt = iter;
      bestRtp = validatedRtp;
      break;
    } else {
      console.log(`✗ Falso positivo (validación fuera de tolerance). Revierto y sigo.`);
      for (let r = 0; r < 5; r++) strips[r] = savedStrips[r]!;
      // Reset bestRtp basado en la validación (más confiable que el RTP "rápido").
      bestRtp = validatedRtp;
      // Aumentamos temperature un poco para no quedarnos atascados.
      temperature *= 1.5;
    }
  }
}

if (convergedAt < 0) {
  console.log('');
  console.log(`⚠ No convergió en ${MAX_ITERATIONS} iters. Mejor encontrado: RTP=${(bestRtp * 100).toFixed(4)}%`);
  // Aplicar el best snapshot a las strips finales.
  for (let r = 0; r < 5; r++) strips[r] = [...bestStripsSnapshot[r]!];
}

// ── Output final ──
console.log('');
console.log('═══════════════════════════════════════════════════════');
console.log(`  REEL STRIPS FINAL (best RTP ${(bestRtp * 100).toFixed(4)}%)`);
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
  bolos: [], ruby: [], sapphire: [], emerald: [],
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
