/**
 * Errores específicos del módulo payment-methods.
 * El controller los traduce a HttpExceptions con error codes legibles.
 */

export class PaymentMethodNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Payment method '${id}' no existe.`);
    this.name = 'PaymentMethodNotFoundError';
  }
}

export class PaymentMethodCodeConflictError extends Error {
  constructor(public readonly code: string) {
    super(`Payment method con code '${code}' ya existe en este tenant.`);
    this.name = 'PaymentMethodCodeConflictError';
  }
}
