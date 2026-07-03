/**
 * Errores del dominio House / tesorería (Blindaje núcleo, Parte B).
 */

/** La transferencia bancaria referida no existe. */
export class HouseBankTxNotFoundError extends Error {
  constructor(id: string) {
    super(`Transferencia bancaria ${id} no encontrada.`);
    this.name = 'HouseBankTxNotFoundError';
  }
}

/** El aporte de capital exige una transferencia ENTRANTE (la plata del dueño). */
export class HouseBankTxNotIncomingError extends Error {
  constructor() {
    super(
      'El aporte de capital requiere una transferencia entrante (incoming).',
    );
    this.name = 'HouseBankTxNotIncomingError';
  }
}

/** Esa transferencia ya está matcheada (con un depósito, retiro u otro aporte). */
export class HouseBankTxAlreadyMatchedError extends Error {
  constructor() {
    super('Esa transferencia ya está asociada a otra operación.');
    this.name = 'HouseBankTxAlreadyMatchedError';
  }
}

/**
 * La casa que banca el round no tiene fondos para pagar un premio (modelo
 * estricto). El round se voidea (rollback atómico). Si es la Casa del tenant,
 * el dueño debe aportar capital; si es un operador independiente (banca su
 * propio riesgo), el operador debe mantener saldo suficiente en su billetera.
 */
export class HouseInsufficientForWinError extends Error {
  constructor(
    public readonly winAmount: string,
    public readonly isOperatorHouse = false,
  ) {
    super(
      isOperatorHouse
        ? `El operador independiente no tiene fondos para pagar este premio (${winAmount}). Su billetera debe cubrir los premios de su red.`
        : `La Casa no tiene fondos para pagar este premio (${winAmount}). Aportá capital a la Casa.`,
    );
    this.name = 'HouseInsufficientForWinError';
  }
}

/**
 * Se lanza al intentar hacer injectCapital/injectBudget con
 * operatorUserId apuntando a un user que no existe o no tiene
 * is_independent_branch = true. El operador debe ser un socio indep
 * válido; si querés inyectar a la Casa, dejá operatorUserId sin
 * setear (o pasá null).
 */
export class InjectOperatorInvalidError extends Error {
  constructor(public readonly operatorUserId: string, public readonly reason: 'not_found' | 'not_indep') {
    super(reason === 'not_found'
      ? `Operador ${operatorUserId} no existe.`
      : `Operador ${operatorUserId} no está marcado como sucursal independiente. Aportá capital solo a socios indep válidos.`);
    this.name = 'InjectOperatorInvalidError';
  }
}

/**
 * Se lanza cuando la wallet issuer resuelta (Casa o indep) no tiene saldo
 * suficiente para fondear una operación (deposit approve, correction, etc.).
 * El caller debe abortar la tx y devolver 409 al cliente.
 */
export class IssuerInsufficientBalanceError extends Error {
  constructor(
    public readonly issuerWalletId: string,
    public readonly issuerUserId: string | null,
    public readonly available: string,
    public readonly required: string,
    public readonly isCasa: boolean,
  ) {
    super(
      `Issuer wallet ${issuerWalletId} (${isCasa ? 'Casa' : 'indep ' + issuerUserId}) tiene ${available}, requiere ${required}`,
    );
    this.name = 'IssuerInsufficientBalanceError';
  }
}
