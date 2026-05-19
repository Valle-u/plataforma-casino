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
