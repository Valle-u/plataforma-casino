/**
 * Errores del subsistema de game rounds (bet/win/rollback).
 */

export class GameBetOutOfRangeError extends Error {
  constructor(
    public readonly bet: string,
    public readonly minBet: string | null,
    public readonly maxBet: string | null,
  ) {
    super(
      `Bet ${bet} fuera de rango [${minBet ?? '∞'}, ${maxBet ?? '∞'}].`,
    );
    this.name = 'GameBetOutOfRangeError';
  }
}

export class GameRoundNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Game round '${id}' no encontrado.`);
    this.name = 'GameRoundNotFoundError';
  }
}

export class GameRoundAlreadySettledError extends Error {
  constructor(public readonly id: string) {
    super(`Game round '${id}' ya está settled o rolled_back.`);
    this.name = 'GameRoundAlreadySettledError';
  }
}

/**
 * Auditoría economía (2026-07): techo de sanidad del winAmount reportado por el
 * provider. El premio del juego es mint puro (sin tope de negocio, por decisión
 * del dueño), PERO eso no obliga a aceptar un winAmount absurdo/ilegítimo. Si el
 * setting `games.max_win_ceiling` está configurado (>0) y el win lo supera, se
 * rechaza la ronda (rollback del bet) para no mintear fichas sin control — casi
 * siempre síntoma de un provider comprometido o un bug del adapter. Default: 0
 * (apagado), no afecta la operación normal hasta que se configure.
 */
export class GameWinExceedsCeilingError extends Error {
  constructor(
    public readonly winAmount: string,
    public readonly ceiling: string,
  ) {
    super(
      `winAmount ${winAmount} supera el techo de sanidad configurado (${ceiling}). Ronda rechazada — revisar el provider.`,
    );
    this.name = 'GameWinExceedsCeilingError';
  }
}
