/**
 * Errores del subsistema de promociones / sorteos.
 */

export class PromotionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class PromotionNotFoundError extends PromotionError {
  constructor(id: string) {
    super(`Promotion ${id} no existe.`);
  }
}

export class PromotionNotActiveError extends PromotionError {
  constructor(id: string, status: string) {
    super(`Promotion ${id} no está activa (status=${status}).`);
  }
}

export class PromotionCodeConflictError extends PromotionError {
  constructor(code: string) {
    super(`Ya existe una promotion con code='${code}'.`);
  }
}

/** Tipo de promotion no compatible con la operación. */
export class PromotionTypeMismatchError extends PromotionError {
  constructor(id: string, expected: string, actual: string) {
    super(`Promotion ${id} es type='${actual}'; se esperaba '${expected}'.`);
  }
}

/** Schedule no permite la acción ahora (fuera de starts_at..ends_at). */
export class PromotionScheduleClosedError extends PromotionError {
  constructor(id: string) {
    super(`Promotion ${id} fuera del rango activo (starts_at/ends_at).`);
  }
}

/** El user ya tiene reward del key de idempotency (ya giró hoy, etc.). */
export class PromotionAlreadyClaimedError extends PromotionError {
  constructor(
    public readonly idempotencyKey: string,
  ) {
    super(`Promotion ya fue reclamada en este período (key=${idempotencyKey}).`);
  }
}

/** Config inválida del wheel (probabilidades no suman, segments vacíos). */
export class WheelConfigInvalidError extends PromotionError {
  constructor(reason: string) {
    super(`daily_wheel config inválida: ${reason}`);
  }
}

/** Funder sin saldo para pagar el premio. */
export class FunderInsufficientBalanceError extends PromotionError {
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
