/**
 * Errores del subsistema de game sessions.
 */

export class GameSessionNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Game session '${id}' no encontrada.`);
    this.name = 'GameSessionNotFoundError';
  }
}

export class GameSessionNotActiveError extends Error {
  constructor(public readonly id: string) {
    super(`Game session '${id}' no está activa (cerrada o expirada).`);
    this.name = 'GameSessionNotActiveError';
  }
}

export class GameSessionUserMismatchError extends Error {
  constructor(
    public readonly sessionId: string,
    public readonly actorUserId: string,
  ) {
    super(
      `Game session '${sessionId}' no pertenece al actor '${actorUserId}'.`,
    );
    this.name = 'GameSessionUserMismatchError';
  }
}
