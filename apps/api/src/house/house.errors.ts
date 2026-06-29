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
