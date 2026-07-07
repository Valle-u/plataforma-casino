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

/**
 * Auditoría economía (2026-07): guard barato de config. Hoy `config` es jsonb
 * libre; validamos al menos `rtp` (si viene) para que un RTP fuera de (0,1] no
 * quede guardado — un RTP>1 haría que la casa pierda estructuralmente.
 */
export class GameInvalidConfigError extends Error {
  constructor(public readonly reason: string) {
    super(`Config de game inválida: ${reason}`);
    this.name = 'GameInvalidConfigError';
  }
}
