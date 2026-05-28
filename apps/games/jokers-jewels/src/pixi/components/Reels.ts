/**
 * Reels — contenedor de los 5 reels del slot.
 *
 * El fondo de cada columna (patrón quilted + bordes dorados + gloss del
 * cilindro) lo aporta la textura `reel.strip` dentro de cada Reel, que
 * además scrollea verticalmente durante el spin. Por eso acá solo queda
 * un background base sólido como backstop y los 5 reels encima.
 */

import { Container, Graphics } from 'pixi.js';
import type { Board, SymbolCode } from '@casino/games-jokers-jewels';
import { Reel } from './Reel';
import { REELS, SYMBOL_SIZE } from '../core/Layout';
import { PALETTE } from '../core/Palette';

export class Reels extends Container {
  private reels: Reel[] = [];

  constructor(initialBoard: Board) {
    super();

    // ── 1. Background base (backstop sólido, queda tapado por las
    //       texturas de cada reel salvo que el asset no cargue) ────────
    const bg = new Graphics()
      .rect(0, 0, REELS.WIDTH, REELS.HEIGHT)
      .fill({ color: PALETTE.BG_REEL });
    this.addChild(bg);

    // ── 2. Reels (5 columnas con símbolos + fondo texturado propio) ──
    for (let col = 0; col < REELS.COLS; col++) {
      const columnSymbols = initialBoard[col] ?? [];
      const reel = new Reel(col, [...columnSymbols]);
      reel.position.set(col * SYMBOL_SIZE.WIDTH, 0);
      this.reels.push(reel);
      this.addChild(reel);
    }
  }

  /**
   * Arranca el spin de los 5 reels. Resuelve cuando TODOS pararon.
   *
   * Si los primeros 3 reels comparten un símbolo premium en alguna fila
   * (potencial línea ganadora), los reels 4 y 5 entran en anticipation:
   * frenan en cámara lenta para crear el momento de tensión del original.
   */
  async spin(finalBoard: Board): Promise<void> {
    const anticipate = shouldAnticipate(finalBoard);
    await Promise.all(
      this.reels.map((reel, col) =>
        reel.spin([...(finalBoard[col] ?? [])], anticipate && col >= 3),
      ),
    );
  }
}

/** Símbolos premium que disparan el momento de tensión. */
const PREMIUM: ReadonlySet<SymbolCode> = new Set(['joker', 'crown']);

/**
 * True si los reels 0,1,2 alinean el MISMO símbolo premium en alguna de
 * las 3 filas — significa que el jugador ya tiene 3 iguales y los reels
 * restantes podrían extender la línea a 4 o 5 (más premio).
 */
function shouldAnticipate(board: Board): boolean {
  if (board.length < 3) return false;
  for (let row = 0; row < 3; row++) {
    const s0 = board[0]?.[row];
    const s1 = board[1]?.[row];
    const s2 = board[2]?.[row];
    if (s0 && s0 === s1 && s1 === s2 && PREMIUM.has(s0)) return true;
  }
  return false;
}
