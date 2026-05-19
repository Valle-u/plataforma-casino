/**
 * Errores específicos del módulo responsible-gaming.
 */

export class DepositLimitExceededError extends Error {
  constructor(
    public readonly window: 'daily' | 'weekly' | 'monthly',
    public readonly cap: string,
    public readonly used: string,
    public readonly attempted: string,
  ) {
    super(
      `Excede el límite ${window} de depósito: cap=${cap}, usado=${used}, intentado=${attempted}.`,
    );
    this.name = 'DepositLimitExceededError';
  }
}

/**
 * El user tiene una `self_exclusions` activa. Bloquea login + creación
 * de depósitos. Si `endsAt` es null → permanent (solo admin revoca).
 */
export class UserExcludedError extends Error {
  constructor(
    public readonly userId: string,
    public readonly type: 'cool_off' | 'temporary' | 'permanent',
    public readonly endsAt: Date | null,
  ) {
    const until =
      endsAt === null
        ? 'permanente'
        : `hasta ${endsAt.toISOString()}`;
    super(`User ${userId} bloqueado por auto-exclusión (${type}, ${until}).`);
    this.name = 'UserExcludedError';
  }
}

export class ExclusionAlreadyActiveError extends Error {
  constructor(public readonly userId: string) {
    super(`User ${userId} ya tiene una exclusión activa.`);
    this.name = 'ExclusionAlreadyActiveError';
  }
}

export class ExclusionNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Exclusión '${id}' no encontrada o no activa.`);
    this.name = 'ExclusionNotFoundError';
  }
}
