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

// ──────────────────────────────────────────────────────────────────────
// Comisiones por red (modelo operativo, docs/16-tesoreria.md §11) — C1
// ──────────────────────────────────────────────────────────────────────

/** La tasa fuera del rango válido [0, 100]. */
export class InvalidNetworkRateError extends Error {
  constructor(public readonly rate: number) {
    super(`La comisión debe estar entre 0 y 100 (recibido: ${rate}).`);
    this.name = 'InvalidNetworkRateError';
  }
}

/** El usuario objetivo no es un hijo DIRECTO del que intenta fijar la tasa. */
export class NotDirectChildError extends Error {
  constructor() {
    super('Solo podés fijar la comisión de tus hijos directos.');
    this.name = 'NotDirectChildError';
  }
}

/** La tasa supera el tope (lo que el que la fija cobra de su propio padre). */
export class NetworkRateExceedsParentError extends Error {
  constructor(
    public readonly rate: number,
    public readonly cap: number,
  ) {
    super(
      `No podés pagarle a un hijo más de lo que vos cobrás: ${rate}% supera tu tope de ${cap}%.`,
    );
    this.name = 'NetworkRateExceedsParentError';
  }
}
