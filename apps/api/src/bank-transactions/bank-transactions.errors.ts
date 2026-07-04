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

/**
 * Se intentó editar o borrar una transferencia que ya está matcheada.
 * Solo se pueden tocar las que todavía no se vincularon a un deposit/withdrawal.
 */
export class BankTransactionMatchedImmutableError extends Error {
  constructor(id: string, op: 'editar' | 'borrar') {
    super(
      `No se puede ${op} una transferencia ya matcheada (${id}). Desmatchéala primero.`,
    );
    this.name = 'BankTransactionMatchedImmutableError';
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

/**
 * D2-light: el actor superó el rate-limit soft de uploads en la última hora
 * (por cantidad o por monto acumulado). No es un bloqueo permanente — el
 * throttle se libera al expirar la ventana. Vive fuera del RateLimitGuard
 * genérico porque el criterio es sobre datos persistidos (bank_transactions)
 * y no sobre un contador in-memory.
 */
export class BankTransactionUploadRateLimitedError extends Error {
  constructor(
    public readonly reason: 'count' | 'amount',
    public readonly current: number,
    public readonly limit: number,
  ) {
    super(
      `Límite alcanzado (${reason === 'count' ? 'uploads por hora' : 'monto acumulado por hora'}: ${current}/${limit}). Contactá al admin.`,
    );
    this.name = 'BankTransactionUploadRateLimitedError';
  }
}
