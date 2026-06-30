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

/**
 * Al BAJAR la tasa de un nodo por debajo de la de alguno de sus hijos activos
 * se rompería el markup (hijo% > padre%). Bloqueo bidireccional del invariante.
 */
export class NetworkRateBelowChildrenError extends Error {
  constructor(
    public readonly rate: number,
    public readonly maxChildRate: number,
  ) {
    super(
      `No podés cobrar menos de lo que le pagás a un hijo: ${rate}% es menor que el ${maxChildRate}% de un hijo tuyo. Bajá primero la de tus hijos.`,
    );
    this.name = 'NetworkRateBelowChildrenError';
  }
}

// ──────────────────────────────────────────────────────────────────────
// Motor NetWin (C2)
// ──────────────────────────────────────────────────────────────────────

/** Se intentó recomputar un período que ya tiene resultados liquidados ('paid'). */
export class PeriodAlreadySettledError extends Error {
  constructor(public readonly periodStart: string) {
    super(
      `El período que arranca ${periodStart} ya tiene comisiones liquidadas; no se puede recomputar.`,
    );
    this.name = 'PeriodAlreadySettledError';
  }
}

/**
 * Markup invertido detectado en el compute: algún operador tiene un hijo con
 * un % MAYOR al suyo (config inválida que generaría gross negativo espurio).
 * Aborta el cómputo del período hasta que se corrija la config.
 */
export class InvertedMarkupError extends Error {
  constructor(
    public readonly offenders: Array<{
      parentUserId: string;
      childUserId: string;
      parentRate: number;
      childRate: number;
    }>,
  ) {
    super(
      `Markup invertido en ${offenders.length} relación(es): un hijo cobra más que su padre. Corregí los % antes de computar.`,
    );
    this.name = 'InvertedMarkupError';
  }
}

/**
 * El invariante de conservación (Σ gross == Σ_{operadores raíz} R·subNetWin) se
 * violó más allá de la tolerancia de redondeo. Indica un bug del motor o data
 * corrupta: aborta la transacción (fail-closed, no se persiste nada).
 */
export class ConservationViolationError extends Error {
  constructor(
    public readonly periodStart: string,
    public readonly actualGross: string,
    public readonly expectedTotal: string,
    public readonly diff: string,
  ) {
    super(
      `Conservación NetWin violada en ${periodStart}: gross=${actualGross} ` +
        `esperado=${expectedTotal} diff=${diff}.`,
    );
    this.name = 'ConservationViolationError';
  }
}
