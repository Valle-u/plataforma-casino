/**
 * MockGameProvider — implementación mock que cumple `IGameProvider`.
 *
 * Sprint 35. MVP del subsistema de juegos sin engine real. Cada
 * `settleRound` corre RNG simple y devuelve win/lose según el RTP del
 * `game.config.rtp`.
 *
 * Algoritmo `settleRound` (slots/crash/table mock — todos comparten):
 *   1. roll = rng() ∈ [0, 1).
 *   2. winProb = config.rtp ?? 0.95. Default conservador.
 *   3. Si roll > winProb → lose, winAmount = 0.
 *   4. Sino → win, multiplier ∈ [1.5, 5] según roll (cuanto más alto
 *      el roll, más alto el multiplier). winAmount = bet * multiplier.
 *
 * Esto NO es matemáticamente exacto al RTP target (un RTP "real" requiere
 * distribución de multipliers que promedien al RTP). Para MVP del mock,
 * el approach es suficiente — el jugador "siente" que a veces gana, a
 * veces pierde, y la casa tiene un edge razonable.
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

  async launchGame(params: LaunchParams): Promise<LaunchResult> {
    const providerSessionId = generateUuidV7();
    // URL relativa — el frontend del player tiene la ruta interactiva
    // en /play/games/<code>/play/iframe?session=<id>.
    const launchUrl = `/play/games/${params.game.code}/play/iframe?session=${providerSessionId}`;
    return { providerSessionId, launchUrl };
  }

  async settleRound(params: SettleParams): Promise<SettleResult> {
    const rng = params.rng ?? Math.random;
    const roll = rng();

    const config = params.game.config as { rtp?: number } | null;
    const winProb = typeof config?.rtp === 'number' ? config.rtp : 0.95;

    const betCents = toCents(params.betAmount);

    let winAmount = '0';
    let multiplier = 0;

    if (roll <= winProb) {
      // Ganó. Multiplier 1.5 a 5, escalado por roll relativo al winProb.
      // roll = 0 → multiplier 1.5; roll = winProb → multiplier 5.
      const ratio = winProb > 0 ? roll / winProb : 0;
      multiplier = 1.5 + ratio * 3.5;
      const winCents = Math.round(betCents * multiplier);
      winAmount = fromCents(winCents);
    }

    return {
      winAmount,
      payload: {
        rng: roll,
        rtp: winProb,
        multiplier: Number(multiplier.toFixed(4)),
        provider: 'mock',
        // Reels simulados para mostrar en UI (decoración, no afectan).
        reels: rollReels(rng, multiplier > 0),
      },
    };
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
