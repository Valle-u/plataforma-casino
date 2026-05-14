/**
 * Errores del subsistema antifraude.
 */

export class FraudError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class FraudLinkNotFoundError extends FraudError {
  constructor(id: string) {
    super(`fraud_account_link ${id} no existe.`);
  }
}

export class FraudLinkAlreadyResolvedError extends FraudError {
  constructor(id: string, status: string) {
    super(`fraud_account_link ${id} ya fue resuelto (status=${status}).`);
  }
}
