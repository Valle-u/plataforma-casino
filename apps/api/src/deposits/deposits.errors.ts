/**
 * Errores del dominio deposits. Se mapean a HTTP en el controller.
 */

export class DepositError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** Demasiados depósitos pending/under_review (max 2 por user). */
export class TooManyPendingDepositsError extends DepositError {
  constructor(public readonly current: number) {
    super(`Ya tenés ${current} depósitos pendientes (máx 2). Esperá a que se resuelvan.`);
  }
}

/** El método de pago no existe o está inactivo. */
export class InvalidPaymentMethodError extends DepositError {
  constructor(public readonly methodId: string) {
    super(`Método de pago ${methodId} no existe o está inactivo.`);
  }
}

/** El depósito no existe. */
export class DepositNotFoundError extends DepositError {
  constructor(public readonly depositId: string) {
    super(`Deposit ${depositId} no existe.`);
  }
}

/** El depósito ya fue resuelto (approved/rejected/expired/cancelled). */
export class DepositAlreadyResolvedError extends DepositError {
  constructor(
    public readonly depositId: string,
    public readonly status: string,
  ) {
    super(`Deposit ${depositId} ya está en estado "${status}" — no se puede modificar.`);
  }
}
