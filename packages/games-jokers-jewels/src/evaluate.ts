/**
 * Evaluación de paylines — calcula los wins de un board ya generado.
 *
 * Recibe el board (5 reels × 3 filas de símbolos visibles) y devuelve
 * la lista de líneas ganadoras + el total.
 *
 * Algoritmo (por payline):
 *   1. Extraer los 5 símbolos que toca la payline (uno por reel).
 *   2. Encontrar el run consecutivo desde la izquierda:
 *      - El "símbolo base" es el primer NO-joker. Si la línea es all-
 *        joker, el base es joker.
 *      - Contar consecutivos desde la izquierda donde cada símbolo sea
 *        el base O un joker (los jokers actúan como wild).
 *   3. Si count >= 3, pagar según PAYTABLE[base][count] × bet/líneas.
 *   4. Edge case: 5 jokers → paga 5 jokers (el premio más alto del juego).
 *
 * Devuelve también qué celdas del board son ganadoras — útil para el
 * cliente que las highlightea con animación.
 */

import { PAYLINES, PAYTABLE, REEL_COUNT, type SymbolCode } from './config';

export interface PaylineWin {
  /** Índice de la payline (0-4). */
  paylineIndex: number;
  /** Símbolo base del win (no es joker, salvo el caso all-joker). */
  symbol: SymbolCode;
  /** Cuántos consecutivos formaron el win (3, 4 o 5). */
  count: 3 | 4 | 5;
  /** Multiplicador del payout en unidades de bet POR LÍNEA. */
  multiplier: number;
  /** Win individual de esta línea en unidades de bet TOTAL (= bet × multiplier / NUM_PAYLINES). */
  win: number;
  /**
   * Celdas del board que forman el win, como tuplas [reelIndex, rowIndex].
   * El cliente las usa para highlight visual.
   */
  cells: ReadonlyArray<readonly [number, number]>;
}

/**
 * Board del slot: 5 reels × 3 filas visibles.
 * `board[reelIndex][rowIndex]` → símbolo en esa celda.
 */
export type Board = ReadonlyArray<readonly SymbolCode[]>;

/**
 * Evalúa todas las paylines del board y devuelve los wins encontrados.
 *
 * `bet` es el bet TOTAL del spin (incluye las 5 líneas). El multiplier
 * del paytable es POR LÍNEA, así que dividimos por NUM_PAYLINES.
 */
export function evaluatePaylines(board: Board, bet: number): PaylineWin[] {
  if (board.length !== REEL_COUNT) {
    throw new Error(
      `evaluatePaylines: board debe tener ${REEL_COUNT} reels, recibí ${board.length}`,
    );
  }
  const betPerLine = bet / PAYLINES.length;
  const wins: PaylineWin[] = [];

  for (let p = 0; p < PAYLINES.length; p++) {
    const payline = PAYLINES[p]!;
    // Extraer los 5 símbolos que toca esta payline.
    const line: SymbolCode[] = [];
    for (let r = 0; r < REEL_COUNT; r++) {
      const symbol = board[r]![payline[r]!];
      if (!symbol) {
        throw new Error(
          `evaluatePaylines: celda vacía en reel ${r}, fila ${payline[r]}`,
        );
      }
      line.push(symbol);
    }

    // Encontrar el símbolo base (primer no-joker). Si todos son joker,
    // base = joker.
    let base: SymbolCode = 'joker';
    for (const s of line) {
      if (s !== 'joker') {
        base = s;
        break;
      }
    }

    // Contar consecutivos desde la izquierda donde cada símbolo sea el
    // base o un joker.
    let count = 0;
    for (const s of line) {
      if (s === base || s === 'joker') {
        count++;
      } else {
        break;
      }
    }

    // Pagar si count >= 3.
    if (count >= 3) {
      const multiplier = PAYTABLE[base][count as 3 | 4 | 5];
      const win = multiplier * betPerLine;
      // Celdas ganadoras = las primeras `count` celdas de la payline.
      const cells: Array<readonly [number, number]> = [];
      for (let r = 0; r < count; r++) {
        cells.push([r, payline[r]!] as const);
      }
      wins.push({
        paylineIndex: p,
        symbol: base,
        count: count as 3 | 4 | 5,
        multiplier,
        win,
        cells,
      });
    }
  }

  return wins;
}
