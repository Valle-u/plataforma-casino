/**
 * @casino/games-jokers-jewels — math + lógica de spin del slot.
 *
 * Exporta:
 *   - `spin(rng, bet)` — ejecuta un spin y devuelve el SpinResult.
 *   - `simulateJokersJewels(n)` — Monte Carlo, devuelve RTP empírico.
 *   - Tipos: SymbolCode, SpinResult, PaylineWin, Board.
 *   - Constantes: PAYTABLE, PAYLINES, REEL_STRIPS, MAX_WIN_MULTIPLIER.
 *
 * NO incluye cliente UI — ese vive en `apps/games/jokers-jewels/`
 * (a crear en Fase 2).
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
export { simulateJokersJewels } from './simulator';
