/**
 * @casino/games-jokers-jewels — math + lógica de spin del slot.
 *
 * Exporta:
 *   - `spin(rng, bet)` — ejecuta un spin y devuelve el SpinResult.
 *   - Tipos: SymbolCode, SpinResult, PaylineWin, Board.
 *   - Constantes: PAYTABLE, PAYLINES, REEL_STRIPS, MAX_WIN_MULTIPLIER.
 *
 * Para Monte Carlo simulator usar el sub-path `/simulator` (separado
 * para que el cliente UI no arrastre dependencias de `crypto` de Node
 * cuando solo importa el spin core).
 *
 * NO incluye cliente UI — ese vive en `apps/games/jokers-jewels/`.
 */

export { spin, applyCap, type SpinResult } from './spin';
export {
  evaluatePaylines,
  type Board,
  type PaylineWin,
} from './evaluate';
export {
  PAYTABLE,
  PAYLINES,
  REEL_STRIPS,
  REEL_COUNT,
  VISIBLE_ROWS,
  MAX_WIN_MULTIPLIER,
  type SymbolCode,
} from './config';
