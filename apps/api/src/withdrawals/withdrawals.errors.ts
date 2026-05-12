/**
 * Errores del dominio withdrawals.
 */

export class WithdrawalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class TooManyPendingWithdrawalsError extends WithdrawalError {
  constructor(public readonly current: number) {
    super(`Ya tenés ${current} retiros pendientes (máx 2). Esperá a que se resuelvan.`);
  }
}

export class InvalidPaymentMethodError extends WithdrawalError {
  constructor(public readonly methodId: string) {
    super(`Método de pago ${methodId} no existe o está inactivo.`);
  }
}

export class WithdrawalNotFoundError extends WithdrawalError {
  constructor(public readonly withdrawalId: string) {
    super(`Withdrawal ${withdrawalId} no existe.`);
  }
}

export class WithdrawalInvalidStateError extends WithdrawalError {
  constructor(
    public readonly withdrawalId: string,
    public readonly currentStatus: string,
    public readonly attemptedTransition: string,
  ) {
    super(
      `Withdrawal ${withdrawalId} en estado "${currentStatus}" — no se puede "${attemptedTransition}".`,
    );
  }
}
