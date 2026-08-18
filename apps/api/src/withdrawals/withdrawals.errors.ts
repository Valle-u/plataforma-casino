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

/** Sprint 51: markPaid requiere outgoing bank_tx asociada. */
export class WithdrawalRequiresBankTxError extends WithdrawalError {
  constructor(public readonly withdrawalId: string) {
    super(
      `Withdrawal ${withdrawalId} no tiene transferencia bancaria de salida asociada. El empleado de confianza debe cargar la outgoing bank_tx y matchearla antes de marcar paid.`,
    );
  }
}

/**
 * Auditoría economía (2026-07): markFailed NO puede liberar el hold si el
 * retiro ya tiene una outgoing bank_tx matcheada (la plata fiat ya salió).
 * Fallar-y-liberar en ese estado le devolvería las fichas al jugador que YA
 * cobró afuera (doble beneficio: fichas + plata). Si el pago externo se
 * revirtió/rebotó, primero hay que DESMATCHEAR la bank_tx (registrando que la
 * plata volvió) y recién ahí marcar failed.
 */
export class WithdrawalHasMatchedBankTxError extends WithdrawalError {
  constructor(
    public readonly withdrawalId: string,
    public readonly bankTransactionId: string,
  ) {
    super(
      `Withdrawal ${withdrawalId} tiene una transferencia de salida matcheada (${bankTransactionId}) — la plata ya salió. No se puede marcar failed sin antes desmatchear la bank_tx (registrar la reversión del pago).`,
    );
  }
}

/**
 * Un retiro en nombre de un jugador (on-behalf) solo puede targetear a un
 * `usuario_final`. Si el target es un operador, se rechaza — no existe el
 * concepto de "retiro del jugador" para un operador.
 */
export class WithdrawalTargetNotPlayerError extends WithdrawalError {
  constructor(public readonly targetUserId: string) {
    super(
      `El usuario ${targetUserId} no es un jugador (usuario_final). El retiro en nombre del jugador solo aplica a jugadores.`,
    );
  }
}

/** El monto fiat (fichas → fiat del método) está por debajo del mínimo del tenant. */
export class WithdrawalBelowMinimumError extends WithdrawalError {
  constructor(
    public readonly amountFiat: string,
    public readonly minFiat: number,
  ) {
    super(
      `El retiro mínimo es ${minFiat} (solicitaste ${amountFiat}).`,
    );
  }
}
