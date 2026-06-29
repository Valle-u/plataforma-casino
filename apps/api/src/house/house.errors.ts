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
 * La Casa no tiene fondos para pagar un premio (B-build-4a, modelo estricto).
 * El round se voidea (rollback atómico) y el dueño debe aportar capital.
 */
export class HouseInsufficientForWinError extends Error {
  constructor(public readonly winAmount: string) {
    super(
      `La Casa no tiene fondos para pagar este premio (${winAmount}). Aportá capital a la Casa.`,
    );
    this.name = 'HouseInsufficientForWinError';
  }
}
