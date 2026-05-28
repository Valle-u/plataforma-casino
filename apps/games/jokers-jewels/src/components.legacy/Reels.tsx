/**
 * Reels — los 5 reels × 3 filas visibles del slot.
 *
 * Sub-fase 2B (2026-05-26): animación de spin agregada.
 *
 *   1. Cuando `spinning=true`, cada reel pasa a fase 'spinning' y muestra
 *      un strip vertical de símbolos random scrolleando rápido.
 *   2. Stagger: reel 0 para a los 600ms, reel N a los 600 + N*250ms.
 *      Reel 4 (último) para a los 1600ms.
 *   3. Cuando un reel para, pasa a fase 'landing': los símbolos finales
 *      (que ya están en el `board` que viene como prop) hacen un bounce
 *      al aparecer (~320ms).
 *   4. Cuando el bounce termina, fase 'static' — render normal con glow
 *      en celdas ganadoras.
 *
 * El padre (App) actualiza el board ANTES de poner spinning=true, así
 * cuando cada reel deja de girar tiene los símbolos finales listos. El
 * win indicator y los highlights se ocultan mientras spinning=true.
 */

import { useEffect, useRef, useState } from 'react';
import { type Board, type SymbolCode } from '@casino/games-jokers-jewels';
import { Symbol } from './Symbol';

interface ReelsProps {
  board: Board;
  /**
   * Si true, todos los reels arrancan a girar. Cada uno para de a uno
   * con stagger interno.
   */
  spinning?: boolean;
  /**
   * Lista de celdas ganadoras: tuplas [reelIndex, rowIndex]. Esas
   * celdas se renderean con efecto "glowing" para destacarlas tras
   * un win. Se ignora mientras `spinning` o cualquier reel está en
   * fase 'landing'.
   */
  winningCells?: ReadonlyArray<readonly [number, number]>;
}

/**
 * Pool de símbolos para los strips de spin (random visible mientras gira).
 * Excluye `joker` (wild) para que el spin rápido no sugiera wins falsos.
 */
const SPIN_POOL: SymbolCode[] = [
  'crown', 'mandolin', 'boots', 'bolos', 'ruby', 'sapphire', 'emerald',
];

/** Cantidad de símbolos en el strip random de spin. */
const SPIN_STRIP_LENGTH = 18;

/** ms hasta que el reel 0 para. Los siguientes se escalonan con STAGGER. */
const FIRST_REEL_STOP_MS = 600;
/** ms de stagger entre cada reel consecutivo. */
const REEL_STAGGER_MS = 250;
/** ms del bounce de landing antes de volver a estado static. */
const LANDING_DURATION_MS = 320;

export function Reels({ board, spinning = false, winningCells = [] }: ReelsProps) {
  const winSet = new Set(winningCells.map(([r, row]) => `${r}-${row}`));
  return (
    <div className="jj-reels">
      {board.map((reel, reelIdx) => (
        <Reel
          key={reelIdx}
          reelIndex={reelIdx}
          finalSymbols={reel}
          spinning={spinning}
          winSet={winSet}
        />
      ))}
      <style>{`
        .jj-reels {
          position: relative;
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 8px;
          background:
            var(--jj-pattern-quilt),
            radial-gradient(
              ellipse at top,
              var(--jj-bg-reel) 0%,
              var(--jj-bg-reel-deep) 75%,
              var(--jj-bg-deepest) 100%
            );
          background-size: 80px 80px, cover;
          padding: 14px 10px;
          border-top: 2px solid var(--jj-gold-deep);
          border-bottom: 2px solid var(--jj-gold-deep);
          box-shadow:
            inset 0 4px 16px rgba(0, 0, 0, 0.6),
            inset 0 -4px 16px rgba(0, 0, 0, 0.6),
            inset 0 0 0 1px rgba(255, 215, 0, 0.15);
        }

        .jj-reels::before {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(
            180deg,
            rgba(74, 32, 128, 0.35) 0%,
            rgba(45, 21, 71, 0.25) 100%
          );
          pointer-events: none;
        }

        .jj-reel {
          position: relative;
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 0;
          z-index: 1;
          /* Crítico para que el spinner overlay no salga de los bordes. */
          overflow: hidden;
        }

        /* Separadores chrome dorados verticales entre cada reel. */
        .jj-reel::after {
          content: '';
          position: absolute;
          top: -6px;
          bottom: -6px;
          right: -6px;
          width: 4px;
          background: linear-gradient(
            90deg,
            var(--jj-gold-deep) 0%,
            var(--jj-gold-bright) 35%,
            #ffffff 50%,
            var(--jj-gold-bright) 65%,
            var(--jj-gold-deep) 100%
          );
          border-radius: 2px;
          box-shadow:
            0 0 6px rgba(255, 215, 0, 0.5),
            inset 0 0 1px rgba(255, 255, 255, 0.8);
          /* Por encima de overflow:hidden del reel */
          z-index: 2;
        }
        .jj-reel:last-child::after {
          display: none;
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

        /* ─── Spin animation ──────────────────────────────────────────
         * El spinner es un overlay absolute sobre el reel. Tiene 18 cells
         * de symbols random apilados. La animación translateY hace que
         * "bajen" 3 cells (= 100% del alto del reel) en 180ms, en loop.
         * Con symbols random la repetición no se nota.
         */
        .jj-reel-spinner {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          display: flex;
          flex-direction: column;
          gap: 4px;
          animation: jj-spin-scroll 180ms linear infinite;
          will-change: transform;
        }

        @keyframes jj-spin-scroll {
          from { transform: translateY(-100%); }
          to { transform: translateY(0); }
        }

        /* ─── Landing bounce ──────────────────────────────────────────
         * Cuando el reel para, los cells que se vuelven visibles hacen
         * un pequeño bounce: aparecen desde arriba (-12px) con overshoot
         * spring, en 320ms.
         */
        .jj-reel-landing .jj-cell {
          animation: jj-cell-land 320ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
        }
        @keyframes jj-cell-land {
          0% {
            transform: translateY(-18px);
            opacity: 0.4;
          }
          60% {
            transform: translateY(4px);
            opacity: 1;
          }
          100% {
            transform: translateY(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Reel sub-component
// ──────────────────────────────────────────────────────────────────────

type ReelPhase = 'static' | 'spinning' | 'landing';

interface ReelProps {
  reelIndex: number;
  finalSymbols: readonly SymbolCode[];
  spinning: boolean;
  winSet: Set<string>;
}

function Reel({ reelIndex, finalSymbols, spinning, winSet }: ReelProps) {
  const [phase, setPhase] = useState<ReelPhase>('static');
  // Strip random fresco para cada spin (regenerado cuando empieza).
  const spinStripRef = useRef<SymbolCode[]>([]);

  useEffect(() => {
    if (!spinning) {
      setPhase('static');
      return;
    }

    // Generar strip fresco para este spin.
    spinStripRef.current = Array.from({ length: SPIN_STRIP_LENGTH }, () => {
      const i = Math.floor(Math.random() * SPIN_POOL.length);
      return SPIN_POOL[i]!;
    });
    setPhase('spinning');

    const stopAt = FIRST_REEL_STOP_MS + reelIndex * REEL_STAGGER_MS;
    const t1 = setTimeout(() => setPhase('landing'), stopAt);
    const t2 = setTimeout(() => setPhase('static'), stopAt + LANDING_DURATION_MS);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [spinning, reelIndex]);

  const isLanding = phase === 'landing';
  const showGlow = phase === 'static';

  return (
    <div className={`jj-reel ${isLanding ? 'jj-reel-landing' : ''}`}>
      {/* Static cells siempre rendered — el spinner los tapa cuando gira */}
      {finalSymbols.map((sym, rowIdx) => {
        const isWin = showGlow && winSet.has(`${reelIndex}-${rowIdx}`);
        return (
          <div key={rowIdx} className="jj-cell">
            <Symbol code={sym} glowing={isWin} />
          </div>
        );
      })}

      {/* Spinner overlay solo durante phase='spinning' */}
      {phase === 'spinning' && (
        <div className="jj-reel-spinner">
          {spinStripRef.current.map((sym, i) => (
            <div key={i} className="jj-cell">
              <Symbol code={sym} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
