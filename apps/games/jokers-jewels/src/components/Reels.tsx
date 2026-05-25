/**
 * Reels — los 5 reels × 3 filas visibles del slot.
 *
 * Sub-fase 2A: estáticos, sin animación de spin. Sólo renderiza un
 * board ya decidido (mostrar el outcome del último spin).
 *
 * Estética target: fondo violeta con patrón rombos sutiles, separadores
 * verticales finos plateados, cada celda contiene un símbolo grande.
 */

import { type Board } from '@casino/games-jokers-jewels';
import { Symbol } from './Symbol';

interface ReelsProps {
  board: Board;
  /**
   * Lista de celdas ganadoras: tuplas [reelIndex, rowIndex]. Esas
   * celdas se renderean con efecto "glowing" para destacarlas tras
   * un win.
   */
  winningCells?: ReadonlyArray<readonly [number, number]>;
}

export function Reels({ board, winningCells = [] }: ReelsProps) {
  const winSet = new Set(winningCells.map(([r, row]) => `${r}-${row}`));
  return (
    <div className="jj-reels">
      {board.map((reel, reelIdx) => (
        <div key={reelIdx} className="jj-reel">
          {reel.map((sym, rowIdx) => {
            const isWin = winSet.has(`${reelIdx}-${rowIdx}`);
            return (
              <div key={rowIdx} className="jj-cell">
                <Symbol code={sym} glowing={isWin} />
              </div>
            );
          })}
        </div>
      ))}
      <style>{`
        .jj-reels {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 0;
          background:
            /* Patrón de rombos sutil */
            repeating-linear-gradient(
              45deg,
              transparent 0,
              transparent 8px,
              rgba(255, 255, 255, 0.025) 8px,
              rgba(255, 255, 255, 0.025) 16px
            ),
            linear-gradient(180deg, var(--jj-bg-reel), var(--jj-bg-deep));
          padding: 8px 6px;
          border-left: 3px solid var(--jj-chrome-mid);
          border-right: 3px solid var(--jj-chrome-mid);
          box-shadow: var(--jj-shadow-inset);
        }
        .jj-reel {
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 0 4px;
          border-right: 1px solid rgba(217, 214, 227, 0.15);
        }
        .jj-reel:last-child {
          border-right: none;
        }
        .jj-cell {
          aspect-ratio: 1;
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 4px;
        }
        .jj-symbol {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
        }
      `}</style>
    </div>
  );
}
