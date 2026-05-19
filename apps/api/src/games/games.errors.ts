/**
 * Errores del módulo games.
 */

export class GameNotFoundError extends Error {
  constructor(public readonly identifier: string) {
    super(`Game '${identifier}' no encontrado.`);
    this.name = 'GameNotFoundError';
  }
}

export class GameCodeConflictError extends Error {
  constructor(public readonly code: string) {
    super(`Ya existe un game con code '${code}'.`);
    this.name = 'GameCodeConflictError';
  }
}

export class GameNotActiveError extends Error {
  constructor(public readonly code: string) {
    super(`Game '${code}' no está activo.`);
    this.name = 'GameNotActiveError';
  }
}
