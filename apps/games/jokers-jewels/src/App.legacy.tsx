/**
 * App principal del cliente Joker's Jewels.
 *
 * Sub-fase 2B (2026-05-26): animación de spin agregada.
 *
 * Flujo del spin:
 *   1. Click spin → calcular result (math sync, ~0ms) → setBoard(result)
 *      inmediato. El nuevo board está "atrás" del spinner overlay.
 *   2. setSpinning(true) → Reels arranca animación per-reel con stagger.
 *   3. Restar bet del crédito (pagaste para girar).
 *   4. Después de SPIN_TOTAL_MS, setSpinning(false) → reels paran de
 *      animar, símbolos finales visibles, glow en celdas ganadoras, win
 *      indicator aparece, sumar winnings al crédito.
 *
 * El spin acá NO llama a un RGS remoto — usa el package math directo.
 * En sub-fase 2C eso se cambia por un fetch al backend.
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
 * Duración total del spin: 1850ms.
 *
 * Coherente con la animación interna de Reels:
 *   - Reel 0 para a 600ms.
 *   - Cada reel siguiente +250ms (250, 500, 750, 1000 stagger).
 *   - Último reel (4) para a 600 + 4*250 = 1600ms.
 *   - Bounce landing: 320ms.
 *   - Total: 1600 + 320 = 1920ms. Usamos 1850 para que el commit del
 *     resultado coincida con cuando el ojo deja de mirar bounces (más
 *     responsive).
 *
 * Si cambia el stagger en Reels.tsx, ajustar acá.
 */
const SPIN_TOTAL_MS = 1850;

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

    // Sub-fase 2A: math con Math.random (RNG no-determinístico).
    // En sub-fase 2C esto se reemplaza por fetch al RGS server.
    const result = spin(createDemoRng(), bet);

    // Commit del board ANTES de poner spinning=true: el spinner overlay
    // tapa los símbolos, así cuando cada reel para, los símbolos finales
    // (que ya están en `board`) están listos para aparecer con el bounce.
    setBoard(result.board);
    // Reset del lastResult anterior para que el glow del win previo se
    // apague mientras gira (winningCells useMemo depende de lastResult).
    setLastResult(null);
    // Pagar la apuesta inmediatamente — UX más realista.
    setCredit((c) => c - bet);
    setSpinning(true);

    // Después de la animación completa: parar el spin, mostrar el
    // resultado (glow en celdas ganadoras + win indicator) y sumar las
    // ganancias al crédito.
    setTimeout(() => {
      setLastResult(result);
      if (result.totalWin > 0) {
        setCredit((c) => c + result.totalWin);
      }
      setSpinning(false);
    }, SPIN_TOTAL_MS);
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
    // No mostrar highlights mientras gira — sólo aparecen al terminar.
    if (spinning || !lastResult || lastResult.totalWin === 0) return [];
    return lastResult.wins.flatMap((w) => w.cells);
  }, [lastResult, spinning]);

  return (
    <div className="jj-app">
      <div className="jj-game">
        <div className="jj-game-inner">
          <Paytable />
          <Reels board={board} spinning={spinning} winningCells={winningCells} />
          <BottomUI
            credit={credit}
            bet={bet}
            onSpin={handleSpin}
            onBetIncrease={handleBetUp}
            onBetDecrease={handleBetDown}
            spinning={spinning}
          />
        </div>
        {/* Cabinet frame overlay — columnas laterales violeta-magenta del
            original. Real DOM element (no ::after) para evitar quirks de
            pseudo-elementos durante re-renders. */}
        <div className="jj-cabinet-frame" aria-hidden="true" />
        {/* Cabinet base — bottom shelf curvo del original Pragmatic
            extraído con Photopea. Cierra el "open-bottom" del cabinet. */}
        <div className="jj-cabinet-base" aria-hidden="true" />
      </div>
      {/* Win indicator se oculta durante el spin para no spoilear el resultado. */}
      <WinIndicator result={spinning ? null : lastResult} />
      <style>{`
        .jj-app {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          position: relative;
        }

        /* ─── Cabinet frame (Capa 2) ────────────────────────────────────
         * Sub-fase 2A.x (2026-05-26): reemplazamos el bezel cromo CSS por
         * el asset gabinete.webp (columnas laterales violeta-magenta
         * extraídas del original con Photopea, open-top + open-bottom).
         *
         * El asset se renderiza como ::after de .jj-game, encima del
         * inner pero con pointer-events:none para no bloquear interacción.
         * Como las columnas del asset están solo en los bordes izq/der,
         * extendemos el ::after con inset negativo para que sobresalgan
         * un poco del .jj-game (efecto de "marco que abraza al cabinet").
         */
        .jj-game {
          position: relative;
          width: 100%;
          max-width: 940px;
          background: linear-gradient(180deg, var(--jj-bg-base), var(--jj-bg-deep));
          border-radius: 16px;
          box-shadow:
            0 12px 40px rgba(0, 0, 0, 0.75),
            0 4px 12px rgba(0, 0, 0, 0.5);
        }

        /* Cabinet frame overlay — div real con el asset gabinete.webp.
         *
         * Estrategia: el div se extiende -25% por izquierda y derecha del
         * .jj-game (ancho total = 150% del cabinet). Como el asset usa
         * background-size: 100% 100%, se estira proporcionalmente al div,
         * logrando DOS efectos a la vez:
         *   1. Las columnas (en los bordes del asset) quedan más separadas
         *      entre sí — sobresalen 25% sobre el backboard azul.
         *   2. Las columnas se ven más ANCHAS (gruesas) porque el asset
         *      entero está escalado al 150% horizontal.
         *
         * Replica la proporción del cabinet ancho del original Pragmatic. */
        .jj-cabinet-frame {
          position: absolute;
          inset: 0 -25% 0 -25%;
          background-image: url('/assets/gabinete.webp');
          background-size: 100% 100%;
          background-repeat: no-repeat;
          background-position: center;
          pointer-events: none;
          z-index: 50;
        }

        /* Cabinet base — bottom shelf curvo posicionado al pie del cabinet.
         * Mismo -25% outboard que .jj-cabinet-frame para que las bases de
         * columnas del asset se alineen con las puntas inferiores de las
         * columnas del frame.
         *
         * Problema: el asset (660:370) tiene casi 50% de transparencia en
         * la mitad superior. Si usamos aspect-ratio del asset entero, el
         * div ocupa ~84% del ancho del cabinet en altura — gigante.
         *
         * Solución: usamos aspect-ratio ESTRECHO (solo la altura del
         * shelf real, no del asset completo) + background-size: 100% auto
         * (mantiene proporción del asset) + background-position: bottom
         * (ancla al bottom) + overflow: hidden (clipea la parte de arriba
         * que sobresale fuera del div). Resultado: solo se ve la franja
         * del shelf, no la transparencia residual. */
        .jj-cabinet-base {
          position: absolute;
          left: -25%;
          right: -25%;
          bottom: -3%;
          aspect-ratio: 660 / 95;
          background-image: url('/assets/base.png');
          background-size: 100% auto;
          background-repeat: no-repeat;
          background-position: bottom center;
          overflow: hidden;
          pointer-events: none;
          /* z-index 51 — encima del cabinet-frame (50) para que las
           * bases tapen las puntas inferiores de las columnas. */
          z-index: 51;
        }

        /* Inner wrapper — el contenido del juego sobre el cabinet inner */
        .jj-game-inner {
          position: relative;
          z-index: 1;
          background: transparent;
          border-radius: 16px;
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
