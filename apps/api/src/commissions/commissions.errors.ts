/**
 * Errores específicos del módulo commissions.
 */

export class CommissionRuleNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Commission rule '${id}' no existe.`);
    this.name = 'CommissionRuleNotFoundError';
  }
}

export class CommissionRuleConflictError extends Error {
  constructor(
    public readonly role: string,
    public readonly eventType: string,
  ) {
    super(`Ya existe una rule para role='${role}' + event='${eventType}'.`);
    this.name = 'CommissionRuleConflictError';
  }
}
