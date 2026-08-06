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

/** Sprint 50: el depósito no tiene bank_transaction asociada — el cajero debe matchear primero. */
export class DepositRequiresBankTxError extends DepositError {
  constructor(public readonly depositId: string) {
    super(
      `Deposit ${depositId} no tiene transferencia bancaria asociada. Matcheá una bank_transaction antes de aprobar.`,
    );
  }
}

/** Sprint 53: el método de pago no pertenece al padre independiente del jugador. */
export class PaymentMethodNotOwnedByParentError extends DepositError {
  constructor(
    public readonly methodId: string,
    public readonly parentId: string,
  ) {
    super(
      `El método de pago no pertenece a tu operador (${parentId}). Usá un método habilitado por tu casa.`,
    );
  }
}

/**
 * Sprint 55: se intentó usar dos veces el MISMO archivo como comprobante
 * (mismo SHA-256 de contenido). El dedupe por `receipt_storage_key` no
 * alcanzaba porque el storage key es un UUID random por upload.
 */
export class DepositDuplicateReceiptError extends DepositError {
  constructor() {
    super(
      'Ese archivo ya se usó como comprobante de otro depósito. Subí un comprobante distinto.',
    );
  }
}
