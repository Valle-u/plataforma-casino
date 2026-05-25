/**
 * App principal del cliente Joker's Jewels.
 *
 * Sub-fase 2A: layout completo con estética target. Estado:
 *   - credit, bet: persistido en memoria (no localStorage todavía).
 *   - board actual: generado por @casino/games-jokers-jewels.spin().
 *   - winningCells: del último spin (para highlight).
 *   - spinning: flag para deshabilitar controles durante el spin.
 *
 * El spin acá NO llama a un RGS remoto — usa el package math directo.
 * En sub-fase 2C eso se cambia por un fetch al backend.
 *
 * Sin animación de spin todavía — el board cambia instantáneamente.
 * Sub-fase 2B agrega animación de reels girando.
 */

import { useCallback, useMemo, useState } from 'react';
import { spin, type Board, type SpinResult } from '@casino/games-jokers-jewels';
import type { DeterministicRng } from '@casino/games-shared/rng';
import { Paytable } from './components/Paytable';
import { Reels } from './components/Reels';
import { BottomUI } from './components/BottomUI';

// Bets disponibles, escalando como en el original.
const BET_LEVELS = [
  0.2, 0.4, 0.6, 0.8, 1, 1.5, 2, 3, 5, 10, 20, 30, 50, 75, 100,
];
const DEFAULT_BET_INDEX = 4; // 1.00 €
const INITIAL_CREDIT = 100_000;

/**
 * RNG NON-determinístico basado en Math.random — solo para sub-fase 2A
 * (UI demo). El provably fair real (con SHA-256 determinístico) requiere
 * el módulo `crypto` de Node, que no existe en browser. En sub-fase 2C
 * el cliente NO ejecuta math — solo fetchea el outcome al RGS server
 * que sí usa el provably fair real.
 *
 * Cumple la interfaz DeterministicRng del games-shared para que `spin()`
 * funcione sin cambios. NO es determinístico — cada llamada da resultados
 * distintos.
 */
function createDemoRng(): DeterministicRng {
  return {
    next: () => Math.random(),
    nextInt: (max: number) => Math.floor(Math.random() * max),
    pick: <T,>(arr: readonly T[]): T => {
      if (arr.length === 0) throw new Error('pick: array vacío');
      return arr[Math.floor(Math.random() * arr.length)] as T;
    },
  };
}

function generateInitialBoard(): Board {
  return spin(createDemoRng(), 1).board;
}

export function App() {
  const [credit, setCredit] = useState(INITIAL_CREDIT);
  const [betIndex, setBetIndex] = useState(DEFAULT_BET_INDEX);
  const [board, setBoard] = useState<Board>(() => generateInitialBoard());
  const [lastResult, setLastResult] = useState<SpinResult | null>(null);
  const [spinning, setSpinning] = useState(false);

  const bet = BET_LEVELS[betIndex]!;

  const handleSpin = useCallback(() => {
    if (spinning) return;
    if (credit < bet) return; // sin fondos suficientes
    setSpinning(true);

    // Sub-fase 2A: math con Math.random (RNG no-determinístico).
    // En sub-fase 2C esto se reemplaza por fetch al RGS server.
    const result = spin(createDemoRng(), bet);

    setTimeout(() => {
      setBoard(result.board);
      setLastResult(result);
      setCredit((c) => c - bet + result.totalWin);
      setSpinning(false);
    }, 300);
  }, [bet, credit, spinning]);

  const handleBetUp = useCallback(() => {
    if (spinning) return;
    setBetIndex((i) => Math.min(i + 1, BET_LEVELS.length - 1));
  }, [spinning]);

  const handleBetDown = useCallback(() => {
    if (spinning) return;
    setBetIndex((i) => Math.max(i - 1, 0));
  }, [spinning]);

  const winningCells = useMemo(() => {
    if (!lastResult || lastResult.totalWin === 0) return [];
    return lastResult.wins.flatMap((w) => w.cells);
  }, [lastResult]);

  return (
    <div className="jj-app">
      <div className="jj-game">
        <Paytable />
        <Reels board={board} winningCells={winningCells} />
        <BottomUI
          credit={credit}
          bet={bet}
          onSpin={handleSpin}
          onBetIncrease={handleBetUp}
          onBetDecrease={handleBetDown}
          spinning={spinning}
        />
      </div>
      <WinIndicator result={lastResult} />
      <style>{`
        .jj-app {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
        }
        .jj-game {
          width: 100%;
          max-width: 900px;
          background: linear-gradient(180deg, var(--jj-bg-base), var(--jj-bg-deep));
          border: 4px solid var(--jj-chrome-bright);
          border-radius: 16px;
          box-shadow:
            0 8px 32px rgba(0, 0, 0, 0.6),
            inset 0 2px 4px rgba(255, 255, 255, 0.1);
          overflow: hidden;
        }
      `}</style>
    </div>
  );
}

/**
 * Banner pequeño que aparece arriba del juego cuando hubo un win.
 * Sub-fase 2A: simple toast estático. Sub-fase 2D: big win modal con
 * confetti.
 */
function WinIndicator({ result }: { result: SpinResult | null }) {
  if (!result || result.totalWin === 0) return null;
  const formatted = result.totalWin.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return (
    <div className="jj-win-indicator">
      ¡GANASTE {formatted} €!
      <style>{`
        .jj-win-indicator {
          position: fixed;
          top: 18px;
          left: 50%;
          transform: translateX(-50%);
          padding: 10px 22px;
          background: linear-gradient(180deg, var(--jj-gold-bright), var(--jj-gold-dark));
          color: var(--jj-bg-deepest);
          font-size: 18px;
          font-weight: 700;
          letter-spacing: 0.04em;
          border-radius: 30px;
          border: 2px solid var(--jj-text-cream);
          box-shadow: 0 4px 16px rgba(255, 215, 0, 0.5);
          z-index: 100;
          animation: jj-win-pop 400ms cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        @keyframes jj-win-pop {
          from { opacity: 0; transform: translateX(-50%) translateY(-20px) scale(0.8); }
          to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
