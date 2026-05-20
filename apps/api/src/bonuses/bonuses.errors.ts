/**
 * Errores del subsistema de bonos.
 *
 * Cada error tipa una falla concreta. El controller los mapea a status
 * HTTP — el service NUNCA tira HttpException directamente.
 */

export class BonusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** No existe la definition con ese id/code. */
export class BonusDefinitionNotFoundError extends BonusError {
  constructor(idOrCode: string) {
    super(`Bonus definition no encontrada: ${idOrCode}`);
  }
}

/** Definition existe pero no está en `status='active'`. No se puede otorgar. */
export class BonusDefinitionNotActiveError extends BonusError {
  constructor(id: string, status: string) {
    super(`Bonus definition ${id} no está activa (status=${status}).`);
  }
}

/** Code duplicado dentro del tenant. */
export class BonusDefinitionCodeConflictError extends BonusError {
  constructor(code: string) {
    super(`Ya existe una bonus definition con code='${code}'.`);
  }
}

/** Funder no tiene saldo suficiente para fondear el bono. */
export class FunderInsufficientBalanceError extends BonusError {
  constructor(
    public readonly funderUserId: string,
    public readonly required: string,
    public readonly available: string,
  ) {
    super(
      `Funder ${funderUserId} no tiene saldo (req=${required}, disp=${available}).`,
    );
  }
}

/** El user target no existe. */
export class BonusTargetNotFoundError extends BonusError {
  constructor(userId: string) {
    super(`User target ${userId} no existe.`);
  }
}

/** La instancia user_bonus no existe. */
export class UserBonusNotFoundError extends BonusError {
  constructor(id: string) {
    super(`user_bonus ${id} no existe.`);
  }
}

/** El user_bonus no está en un estado que permita la operación pedida. */
export class UserBonusInvalidStatusError extends BonusError {
  constructor(id: string, currentStatus: string, allowed: string[]) {
    super(
      `user_bonus ${id} en status='${currentStatus}'; operación requiere status ∈ {${allowed.join(', ')}}.`,
    );
  }
}

/** Idempotency key ya usado con parámetros distintos. */
export class GrantIdempotencyConflictError extends BonusError {
  constructor(public readonly key: string) {
    super(`Grant idempotency key '${key}' ya usado con parámetros distintos.`);
  }
}

/**
 * Sprint 51.2: el actor intenta crear/operar un bono pero no es ni
 * admin_tenant ni socio independent. Solo esos dos roles pueden tocar
 * el subsistema de bonos como "owners".
 */
export class BonusActorRoleError extends BonusError {
  constructor(public readonly actorUserId: string) {
    super(
      `User ${actorUserId} no puede crear/otorgar bonos: solo admin_tenant o socio independent.`,
    );
  }
}

/**
 * Sprint 51.2: el socio independent intenta otorgar/operar un bono sobre
 * un target que NO está bajo su downstream.
 */
export class BonusOutOfBranchScopeError extends BonusError {
  constructor(
    public readonly socioId: string,
    public readonly targetUserId: string,
  ) {
    super(
      `Socio independent ${socioId} no puede operar sobre user ${targetUserId} — está fuera de su downstream.`,
    );
  }
}
