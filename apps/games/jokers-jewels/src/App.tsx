/**
 * App — entry point del cliente PixiJS de Joker's Jewels.
 *
 * Sub-fase 2A.x (2026-05-27): HUD migrado al canvas PixiJS.
 *
 * React solo:
 *   1. Monta el canvas (SlotApp)
 *   2. Maneja state (credit, betIndex, spinning)
 *   3. Pushea state al HUD via setters
 *   4. Escucha eventos del HUD (spin, +/-) y actualiza state
 *
 * Toda la UI visual vive en el canvas. No hay HTML overlay.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { SlotApp } from './pixi/SlotApp';
import type { SpinResult } from '@casino/games-jokers-jewels';

const BET_LEVELS = [0.2, 0.4, 0.6, 0.8, 1, 1.5, 2, 3, 5, 10, 20, 30, 50, 75, 100];
const DEFAULT_BET_INDEX = 4; // 1.00 €
const INITIAL_CREDIT = 100_000;

export function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<SlotApp | null>(null);
  const [ready, setReady] = useState(false);
  const [credit, setCredit] = useState(INITIAL_CREDIT);
  const [betIndex, setBetIndex] = useState(DEFAULT_BET_INDEX);
  const [spinning, setSpinning] = useState(false);

  const bet = BET_LEVELS[betIndex]!;

  // Bootstrap del Pixi App en mount.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const app = new SlotApp(container);
    appRef.current = app;

    let cancelled = false;
    app.init().then(() => {
      if (cancelled) {
        app.destroy();
        return;
      }
      setReady(true);
    }).catch((err: unknown) => {
      console.error('[SlotApp] init failed', err);
    });

    return () => {
      cancelled = true;
      app.destroy();
      appRef.current = null;
    };
  }, []);

  const handleSpin = useCallback(async () => {
    const app = appRef.current;
    if (!app || !ready || spinning) return;
    if (credit < bet) return;

    setSpinning(true);
    setCredit((c) => c - bet);

    try {
      const result: SpinResult = await app.spin(bet);
      if (result.totalWin > 0) {
        setCredit((c) => c + result.totalWin);
      }
    } catch (err) {
      console.error('[App] spin failed', err);
    } finally {
      setSpinning(false);
    }
  }, [bet, credit, ready, spinning]);

  const handleBetUp = useCallback(() => {
    if (spinning) return;
    setBetIndex((i) => Math.min(i + 1, BET_LEVELS.length - 1));
  }, [spinning]);

  const handleBetDown = useCallback(() => {
    if (spinning) return;
    setBetIndex((i) => Math.max(i - 1, 0));
  }, [spinning]);

  // Wirear callbacks del HUD una vez que esté ready.
  // Re-wireamos cada vez que cambian los callbacks (porque sus
  // closures capturan state actual).
  useEffect(() => {
    if (!ready) return;
    const hud = appRef.current?.getHUD();
    if (!hud) return;
    hud.onSpinClick = handleSpin;
    hud.onBetUp = handleBetUp;
    hud.onBetDown = handleBetDown;
  }, [ready, handleSpin, handleBetUp, handleBetDown]);

  // Pushear state actual al HUD cada vez que cambia.
  useEffect(() => {
    if (!ready) return;
    appRef.current?.getHUD()?.setCredit(credit);
  }, [ready, credit]);

  useEffect(() => {
    if (!ready) return;
    appRef.current?.getHUD()?.setBet(bet);
  }, [ready, bet]);

  useEffect(() => {
    if (!ready) return;
    appRef.current?.getHUD()?.setSpinning(spinning);
  }, [ready, spinning]);

  return (
    <div className="jj-app">
      <div className="jj-pixi-container" ref={containerRef} />
      <style>{`
        .jj-app {
          width: 100%;
          height: 100%;
          background: #000;
          position: relative;
          overflow: hidden;
        }
        .jj-pixi-container {
          position: absolute;
          inset: 0;
        }
        .jj-pixi-container canvas {
          display: block;
        }
      `}</style>
    </div>
  );
}
