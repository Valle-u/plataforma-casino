/**
 * MockGameProvider — implementación mock que cumple `IGameProvider`.
 *
 * Sprint 35. MVP del subsistema de juegos sin engine real. Cada
 * `settleRound` corre RNG simple y devuelve win/lose según el RTP del
 * `game.config.rtp`.
 *
 * Algoritmo `settleRound` (slots/crash/table mock — todos comparten):
 *   1. roll = rng() ∈ [0, 1).
 *   2. Premio al ganar: multiplier uniforme ∈ [1.5, 5] (media 3.25).
 *   3. winProb se DERIVA del RTP target para que el pago esperado lo
 *      respete:  RTP = winProb · E[multiplier]  ⇒  winProb = rtp / 3.25.
 *      Con rtp = 0.97 ⇒ winProb ≈ 0.30 (se gana ~30% de las veces).
 *   4. Si roll < winProb → win, multiplier escalado por roll/winProb.
 *      Sino → lose, winAmount = 0.
 *
 * Esto SÍ promedia al RTP target en el largo plazo, así que la casa
 * conserva su edge (rtp 0.97 ⇒ paga ~97%, gana ~3%). Antes (Sprint 35)
 * se usaba config.rtp como probabilidad de ganar y se pagaba 1.5–5×, lo
 * que daba un RTP ~315% (la casa siempre perdía) — corregido.
 *
 * El `rng` se inyecta opcional para tests determinísticos.
 *
 * `launchGame` genera UUID interno + URL local que el frontend usa
 * para embed el mini-game mock (Sprint 35 page nueva).
 *
 * `rollback` es no-op — el mock no tiene estado externo que limpiar.
 */

import { Injectable } from '@nestjs/common';
import { generateUuidV7 } from '@casino/db';
import type {
  IGameProvider,
  LaunchParams,
  LaunchResult,
  RollbackParams,
  SettleParams,
  SettleResult,
} from './game-provider.interface';

@Injectable()
export class MockGameProvider implements IGameProvider {
  readonly code = 'mock';

  launchGame(params: LaunchParams): Promise<LaunchResult> {
    const providerSessionId = generateUuidV7();
    // URL relativa — el frontend del player tiene la ruta interactiva
    // en /play/games/<code>/play/iframe?session=<id>.
    const launchUrl = `/play/games/${params.game.code}/play/iframe?session=${providerSessionId}`;
    return Promise.resolve({ providerSessionId, launchUrl });
  }

  settleRound(params: SettleParams): Promise<SettleResult> {
    const rng = params.rng ?? Math.random;
    const roll = rng();

    const config = params.game.config as { rtp?: number } | null;
    const targetRtp = typeof config?.rtp === 'number' ? config.rtp : 0.95;

    // Multiplier al ganar ∈ [MIN_MULT, MAX_MULT], uniforme (media meanMult).
    // Derivamos winProb del RTP target para que el pago esperado lo respete:
    //   RTP = winProb · meanMult  ⇒  winProb = targetRtp / meanMult.
    // (rtp 0.97, meanMult 3.25 ⇒ winProb ≈ 0.298 → la casa gana ~3%.)
    const MIN_MULT = 1.5;
    const MAX_MULT = 5;
    const meanMult = (MIN_MULT + MAX_MULT) / 2;
    const winProb = Math.min(1, targetRtp / meanMult);

    const betCents = toCents(params.betAmount);

    let winAmount = '0';
    let multiplier = 0;

    if (roll < winProb) {
      // Ganó. Multiplier escalado por la posición del roll dentro de
      // [0, winProb): roll → 0 da MIN_MULT; roll → winProb da MAX_MULT.
      const ratio = winProb > 0 ? roll / winProb : 0;
      multiplier = MIN_MULT + ratio * (MAX_MULT - MIN_MULT);
      const winCents = Math.round(betCents * multiplier);
      winAmount = fromCents(winCents);
    }

    return Promise.resolve({
      winAmount,
      payload: {
        rng: roll,
        rtp: targetRtp,
        multiplier: Number(multiplier.toFixed(4)),
        provider: 'mock',
        // Reels simulados para mostrar en UI (decoración, no afectan).
        reels: rollReels(rng, multiplier > 0),
      },
    });
  }

  async rollback(_params: RollbackParams): Promise<void> {
    // Mock sin estado externo — no-op.
    return Promise.resolve();
  }
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

const SYMBOLS = ['🍒', '🍋', '🍊', '🍇', '⭐', '7️⃣', '💎', '🔔'];

/**
 * Genera 3 reels random. Si `isWin`, fuerza match (3 iguales). Sino,
 * 3 distintos o 2-1 para "casi ganar". Decoración para UI; el RNG real
 * del win fue arriba.
 */
function rollReels(rng: () => number, isWin: boolean): string[] {
  if (isWin) {
    const idx = Math.floor(rng() * SYMBOLS.length);
    return [SYMBOLS[idx]!, SYMBOLS[idx]!, SYMBOLS[idx]!];
  }
  // Lose: garantizar al menos uno distinto.
  const a = Math.floor(rng() * SYMBOLS.length);
  const b = Math.floor(rng() * SYMBOLS.length);
  let c = Math.floor(rng() * SYMBOLS.length);
  if (a === b && b === c) {
    c = (c + 1) % SYMBOLS.length;
  }
  return [SYMBOLS[a]!, SYMBOLS[b]!, SYMBOLS[c]!];
}

function toCents(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function fromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}
