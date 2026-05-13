/**
 * Errores del subsistema 2FA TOTP.
 */

export class TwoFaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** Código TOTP inválido o expirado. */
export class TwoFaCodeInvalidError extends TwoFaError {
  constructor() {
    super('Código 2FA inválido o expirado.');
  }
}

/** El user ya tiene 2FA enabled — no se puede re-iniciar setup sin disable. */
export class TwoFaAlreadyEnabledError extends TwoFaError {
  constructor() {
    super('2FA ya está activo para este user. Desactívalo primero para re-configurar.');
  }
}

/** El user no tiene secret aún — no se puede confirmar/disable. */
export class TwoFaNotInitializedError extends TwoFaError {
  constructor() {
    super('2FA no está inicializado para este user.');
  }
}

/** El user tiene 2FA enabled y la operación requiere un código pero no se proveyó. */
export class TwoFaRequiredError extends TwoFaError {
  constructor() {
    super('Esta operación requiere código 2FA.');
  }
}
