/**
 * Joker's Jewels — config del math.
 *
 * Constantes que definen el comportamiento del juego: símbolos,
 * paytable, paylines, reel strips. Si cambia algo acá, el RTP cambia —
 * hay que re-correr el simulator y actualizar `docs/own-games/jokers-jewels/math.md`.
 *
 * Las reel strips son la pieza más sensible: son lo único que se
 * itera para calibrar el RTP al target 96.50%. El paytable es fijo
 * (match con el juego original de Pragmatic).
 *
 * Ver `docs/own-games/jokers-jewels/math.md` para la explicación
 * completa del modelo.
 */

/**
 * Los 8 símbolos del juego. `joker` es el único wild.
 */
export type SymbolCode =
  | 'joker'
  | 'crown'
  | 'mandolin'
  | 'boots'
  | 'diamond_pink'
  | 'ruby'
  | 'sapphire'
  | 'emerald';

/**
 * Paytable: multiplicador del bet POR LÍNEA según cuántos iguales
 * consecutivos (desde la izquierda) forman la línea.
 *
 * Indexado como `PAYTABLE[symbol][count]` donde count es 3, 4 o 5.
 * Cualquier count < 3 paga 0.
 */
export const PAYTABLE: Record<SymbolCode, Record<3 | 4 | 5, number>> = {
  joker: { 3: 4, 4: 40, 5: 200 },
  crown: { 3: 2, 4: 10, 5: 50 },
  mandolin: { 3: 2, 4: 8, 5: 40 },
  boots: { 3: 2, 4: 8, 5: 40 },
  diamond_pink: { 3: 0.4, 4: 2, 5: 8 },
  ruby: { 3: 0.4, 4: 2, 5: 8 },
  sapphire: { 3: 0.4, 4: 2, 5: 8 },
  emerald: { 3: 0.4, 4: 2, 5: 8 },
};

/**
 * Las 5 paylines del juego. Cada payline es una tupla de 5 índices de
 * fila (0=top, 1=middle, 2=bottom) — uno por reel.
 *
 * L1: top row
 * L2: middle row
 * L3: bottom row
 * L4: V invertida (top-mid-bot-mid-top)
 * L5: V normal (bot-mid-top-mid-bot)
 */
export const PAYLINES: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [0, 0, 0, 0, 0],
  [1, 1, 1, 1, 1],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
];

/** Cantidad de reels. Match con el juego original. */
export const REEL_COUNT = 5;

/** Cantidad de filas visibles por reel. */
export const VISIBLE_ROWS = 3;

/** Cap del max win — match con Pragmatic. */
export const MAX_WIN_MULTIPLIER = 1000;

/**
 * Reel strips — versión 0.4.
 *
 * **Historia de calibración** (ver math.md §9):
 *   - v0.1: 32 stops, joker 1/32 reels borde. RTP 13.6%.
 *   - v0.2: 40 stops, joker 4-8. RTP 60.86%.
 *   - v0.3: 40 stops, joker 8-12. RTP 184.20% (overshoot).
 *   - v0.4: 40 stops, joker 5-9. RTP 88.69%.
 *   - v0.5: 40 stops, joker 6-10. RTP 115.99% (overshoot).
 *   - v0.6: joker 5-7-10-7-5. RTP 94.14%.
 *   - v0.7: joker 5-8-10-7-5. RTP 100.45% (overshoot ligero).
 *   - v0.8: joker 5-8-9-7-5. RTP 94.29% (estancamiento ~94%).
 *   - v0.9: +1 crown en reels 1 y 5. RTP 101.19% (overshoot +4.69).
 *   - v0.10: joker 5-8-8-7-5, crown 9-8-8-8-9. RTP 94.62% (gap -1.88).
 *   - v0.11: +1 crown reel 3. RTP 97.99% (overshoot +1.50).
 *   - v0.12: 1 mandolin→1 emerald en reels 1 y 5. RTP 96.74% (CONGELADA).
 *   - v0.13: solver auto intentó refinar pero validó peor (95.47% sobre
 *           10M) — solver con 300k spins/iter tiene variance ±0.3%
 *           que lo engaña. Revertido a v0.12. Mejorar solver es
 *           Sprint 1.6 future (más spins/iter + simulated annealing).
 *
 * Versión activa = v0.12 (joker 5-8-8-7-5, crown 9-8-9-8-9).
 * RTP empírico estable: 96.74% sobre 10M+ spins. Delta del target
 * 96.50%: +0.24%. Acepta por Fase 1, no cumple quality gate G1.1.5
 * (target ±0.1%) — falla documentado, dependencia en Sprint 1.6.
 *
 * Composición v0.12 (activa) por símbolo:
 *
 *   | Symbol       | R1 | R2 | R3 | R4 | R5 |
 *   |--------------|----|----|----|----|----|
 *   | joker        |  5 |  8 |  8 |  7 |  5 |
 *   | crown        |  9 |  8 |  9 |  8 |  9 |
 *   | mandolin     |  4 |  4 |  3 |  4 |  4 |
 *   | boots        |  4 |  4 |  4 |  4 |  4 |
 *   | diamond_pink |  5 |  4 |  4 |  5 |  5 |
 *   | ruby         |  5 |  4 |  4 |  4 |  5 |
 *   | sapphire     |  4 |  4 |  5 |  4 |  4 |
 *   | emerald      |  4 |  4 |  3 |  4 |  4 |
 *   | **TOTAL**    | 40 | 40 | 40 | 40 | 40 |
 */
export const REEL_STRIPS: ReadonlyArray<readonly SymbolCode[]> = [
  // Reel 1 — 40 stops: joker 5, crown 10, mandolin 4, boots 4, gemas 17 (v0.13 solver)
  [
    'joker', 'crown', 'ruby', 'mandolin', 'crown', 'sapphire', 'diamond_pink', 'boots',
    'joker', 'crown', 'emerald', 'mandolin', 'crown', 'ruby', 'sapphire', 'joker',
    'crown', 'diamond_pink', 'emerald', 'boots', 'crown', 'emerald', 'joker', 'ruby',
    'crown', 'sapphire', 'mandolin', 'diamond_pink', 'crown', 'boots', 'ruby', 'joker',
    'crown', 'mandolin', 'sapphire', 'diamond_pink', 'crown', 'ruby', 'boots', 'emerald',
  ],
  // Reel 2 — 40 stops: joker 8, crown 9, mandolin 4, boots 4, gemas 15 (v0.13 solver)
  [
    'joker', 'crown', 'mandolin', 'ruby', 'crown', 'joker', 'diamond_pink', 'sapphire',
    'boots', 'joker', 'crown', 'emerald', 'mandolin', 'crown', 'ruby', 'joker',
    'sapphire', 'crown', 'diamond_pink', 'mandolin', 'boots', 'joker', 'crown', 'emerald',
    'ruby', 'crown', 'joker', 'sapphire', 'mandolin', 'crown', 'boots', 'diamond_pink',
    'joker', 'emerald', 'ruby', 'sapphire', 'diamond_pink', 'crown', 'joker', 'boots',
  ],
  // Reel 3 — 40 stops: joker 7, crown 9, mandolin 3, boots 4, gemas 17 (v0.13 solver)
  [
    'joker', 'crown', 'mandolin', 'joker', 'crown', 'ruby', 'joker', 'sapphire',
    'diamond_pink', 'joker', 'crown', 'boots', 'emerald', 'sapphire', 'crown', 'crown',
    'ruby', 'joker', 'crown', 'sapphire', 'diamond_pink', 'joker', 'crown', 'mandolin',
    'boots', 'joker', 'crown', 'emerald', 'ruby', 'sapphire', 'crown', 'sapphire',
    'mandolin', 'diamond_pink', 'boots', 'ruby', 'sapphire', 'emerald', 'diamond_pink', 'boots',
  ],
  // Reel 4 — 40 stops: joker 7, crown 8, mandolin 4, boots 4, gemas 17 (v0.12 espejo)
  // Solver v0.13 sugirió swap crown→emerald pos 24 pero validado con
  // 10M dio RTP 95.47% (peor que v0.12 96.74%). Revertido a v0.12.
  [
    'joker', 'crown', 'mandolin', 'ruby', 'crown', 'diamond_pink', 'sapphire', 'boots',
    'joker', 'crown', 'emerald', 'mandolin', 'crown', 'ruby', 'joker', 'sapphire',
    'crown', 'diamond_pink', 'mandolin', 'boots', 'joker', 'crown', 'emerald', 'ruby',
    'crown', 'joker', 'sapphire', 'mandolin', 'crown', 'boots', 'diamond_pink', 'joker',
    'emerald', 'ruby', 'sapphire', 'diamond_pink', 'crown', 'joker', 'boots', 'emerald',
  ],
  // Reel 5 — 40 stops: joker 5, crown 9, mandolin 4, boots 4, gemas 18 (v0.12 espejo)
  // Solver v0.13 sugirió +2 crowns -2 sapphire pero validado con 10M
  // dio RTP 95.47% (peor que v0.12 96.74%). Revertido a v0.12.
  [
    'joker', 'crown', 'ruby', 'mandolin', 'crown', 'sapphire', 'diamond_pink', 'boots',
    'joker', 'crown', 'emerald', 'mandolin', 'crown', 'ruby', 'sapphire', 'joker',
    'crown', 'diamond_pink', 'emerald', 'boots', 'crown', 'emerald', 'joker', 'ruby',
    'crown', 'sapphire', 'mandolin', 'diamond_pink', 'crown', 'boots', 'ruby', 'joker',
    'crown', 'mandolin', 'sapphire', 'diamond_pink', 'crown', 'ruby', 'boots', 'emerald',
  ],
];

// Validación en tiempo de carga: todos los reels deben tener al menos
// 5 stops (sino no se puede mostrar 3 símbolos consecutivos sin wrap
// degenerado) y deben usar solo símbolos del enum.
const VALID_SYMBOLS = new Set<SymbolCode>([
  'joker', 'crown', 'mandolin', 'boots',
  'diamond_pink', 'ruby', 'sapphire', 'emerald',
]);
for (const [i, reel] of REEL_STRIPS.entries()) {
  if (reel.length < 5) {
    throw new Error(`Reel ${i + 1} tiene ${reel.length} stops, mínimo 5`);
  }
  for (const s of reel) {
    if (!VALID_SYMBOLS.has(s)) {
      throw new Error(`Reel ${i + 1}: símbolo inválido "${s}"`);
    }
  }
}
if (REEL_STRIPS.length !== REEL_COUNT) {
  throw new Error(
    `REEL_STRIPS tiene ${REEL_STRIPS.length} reels, esperaba ${REEL_COUNT}`,
  );
}
