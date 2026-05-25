/**
 * Spin del slot — orquesta un round completo.
 *
 * Recibe un RNG determinístico (alimentado por el roundSeed del
 * provably fair) + el bet del jugador, y devuelve el outcome completo:
 * reels que pararon, board visible, wins por línea, total win.
 *
 * Capa de cap del max win: si el total de wins supera 1000× bet (el
 * cap del juego según paytable del original), se trunca. Esto es
 * defensivo — con el paytable actual el max teórico por spin es 5
 * jokers en cada una de las 5 paylines = 5 × 200 = 1000× ya cubierto.
 * Pero si en una iteración futura del paytable subimos algún
 * multiplier, el cap previene "explosiones" inesperadas.
 */

import type { DeterministicRng } from '@casino/games-shared';
import {
  REEL_COUNT,
  REEL_STRIPS,
  VISIBLE_ROWS,
  MAX_WIN_MULTIPLIER,
  type SymbolCode,
} from './config';
import { evaluatePaylines, type Board, type PaylineWin } from './evaluate';

export interface SpinResult {
  /**
   * Stops elegidos en cada reel (0-indexed dentro del strip).
   * Útil para reproducir el spin desde el seed.
   */
  reelStops: ReadonlyArray<number>;
  /** Board visible 5×3 que se muestra al jugador. */
  board: Board;
  /** Lista de paylines ganadoras (puede estar vacía). */
  wins: ReadonlyArray<PaylineWin>;
  /** Win total del spin (suma de wins, capeado al max). */
  totalWin: number;
  /** Bet original del spin. */
  bet: number;
  /** True si el cap del max win se activó (defensivo, rarísimo). */
  cappedAtMax: boolean;
}

/**
 * Genera el board visible eligiendo un stop random en cada reel y
 * tomando 3 símbolos consecutivos (con wrap-around).
 */
function generateBoard(rng: DeterministicRng): { stops: number[]; board: Board } {
  const stops: number[] = [];
  const board: SymbolCode[][] = [];
  for (let r = 0; r < REEL_COUNT; r++) {
    const strip = REEL_STRIPS[r]!;
    const stop = rng.nextInt(strip.length);
    stops.push(stop);
    const reelVisible: SymbolCode[] = [];
    for (let row = 0; row < VISIBLE_ROWS; row++) {
      // Wrap-around: si el stop es cerca del final del strip, las
      // próximas filas se toman del principio.
      reelVisible.push(strip[(stop + row) % strip.length]!);
    }
    board.push(reelVisible);
  }
  return { stops, board };
}

/**
 * Aplica el cap del max win — pura, testeable en aislamiento.
 *
 * Si el rawWin supera `bet × maxMultiplier`, lo trunca al cap y marca
 * el flag. Sino lo devuelve sin cambios.
 *
 * Extraída del spin() en Sprint 54.x (quality gates G1.3.1) para
 * permitir tests del cap sin necesidad de construir un spin completo
 * que llegue a 1000× (lo cual con el paytable actual nunca pasa —
 * el max teórico es 200× bet con board all-jokers).
 */
export function applyCap(
  rawWin: number,
  bet: number,
  maxMultiplier: number = MAX_WIN_MULTIPLIER,
): { totalWin: number; cappedAtMax: boolean } {
  const cap = bet * maxMultiplier;
  const cappedAtMax = rawWin > cap;
  return {
    totalWin: cappedAtMax ? cap : rawWin,
    cappedAtMax,
  };
}

/**
 * Ejecuta un spin completo y devuelve el resultado.
 *
 * `rng` debe estar alimentado por el roundSeed del provably fair
 * (ver `@casino/games-shared.computeRoundSeed`).
 *
 * `bet` es el bet TOTAL del spin (no por línea). El paytable del
 * juego está expresado por-línea internamente; `evaluatePaylines`
 * hace la conversión.
 */
export function spin(rng: DeterministicRng, bet: number): SpinResult {
  if (typeof bet !== 'number' || !Number.isFinite(bet) || bet <= 0) {
    throw new Error(`spin: bet debe ser > 0 y finito, recibí ${bet}`);
  }
  const { stops, board } = generateBoard(rng);
  const wins = evaluatePaylines(board, bet);
  const rawWin = wins.reduce((s, w) => s + w.win, 0);
  const { totalWin, cappedAtMax } = applyCap(rawWin, bet);
  return {
    reelStops: stops,
    board,
    wins,
    totalWin,
    bet,
    cappedAtMax,
  };
}
