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

/**
 * El aprobador (funder de las commissions) no tiene saldo suficiente para
 * cubrir el total. Bloquea el approve del deposit/withdrawal (Opción 3a
 * confirmada por el dueño: si no hay saldo, no se aprueba — el operador
 * tiene que recargar primero).
 *
 * Se mapea a HTTP 409 en el controller con un mensaje específico que
 * deja claro que el bloqueo es por las commissions, NO por el deposit en sí.
 */
export class InsufficientFunderBalanceError extends Error {
  constructor(
    public readonly approverUserId: string,
    public readonly available: string,
    public readonly required: string,
  ) {
    super(
      `El aprobador ${approverUserId} no tiene saldo suficiente para pagar las comisiones: disponible=${available}, requerido=${required}.`,
    );
    this.name = 'InsufficientFunderBalanceError';
  }
}
