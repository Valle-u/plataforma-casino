/**
 * Errores específicos del módulo bank-transactions (Sprint 50).
 *
 * Los controllers los mapean a HTTP errors (400/404/409) con códigos
 * estables que el frontend puede manejar.
 */

export class BankTransactionNotFoundError extends Error {
  constructor(id: string) {
    super(`Bank transaction ${id} no existe.`);
    this.name = 'BankTransactionNotFoundError';
  }
}

export class BankTransactionAlreadyMatchedError extends Error {
  constructor(id: string, matchedDepositId: string) {
    super(`Bank transaction ${id} ya está matcheada con deposit ${matchedDepositId}.`);
    this.name = 'BankTransactionAlreadyMatchedError';
  }
}

export class BankTransactionAmountMismatchError extends Error {
  constructor(bankAmount: string, depositAmount: string) {
    super(
      `Monto de la transferencia ($${bankAmount}) no coincide con el deposit ($${depositAmount}). Si querés matchear igualmente, marcá override con motivo.`,
    );
    this.name = 'BankTransactionAmountMismatchError';
  }
}

export class DepositAlreadyHasBankTxError extends Error {
  constructor(depositId: string) {
    super(`Deposit ${depositId} ya tiene una transferencia bancaria asociada.`);
    this.name = 'DepositAlreadyHasBankTxError';
  }
}

export class BankTransactionDuplicateRefError extends Error {
  constructor(bankAccount: string, bankReference: string) {
    super(
      `Ya existe una transferencia en la cuenta ${bankAccount} con referencia ${bankReference}.`,
    );
    this.name = 'BankTransactionDuplicateRefError';
  }
}
