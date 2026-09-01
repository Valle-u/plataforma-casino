/**
 * Errores específicos del módulo commissions.
 */

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
 * Se intentó liquidar un período que todavía tiene rondas SIN CERRAR.
 *
 * La base de comisión sólo cuenta rondas `settled` (C1/C4b). Una ronda
 * abierta es NetWin que todavía no entró: liquidar así paga de menos, y
 * cuando esa ronda cierre va a caer en un período ya liquidado.
 *
 * No es un error del sistema: es que falta esperar. `RoundsReconciliationCron`
 * corre cada 10 minutos y las cierra solas. Si hay que liquidar igual —
 * porque el proveedor dejó una ronda trabada para siempre y no se puede
 * esperar — se manda `force: true` y queda en el audit log.
 */
export class OpenRoundsInPeriodError extends Error {
  constructor(
    public readonly openRounds: number,
    public readonly periods: string[],
  ) {
    super(
      `Hay ${openRounds} ronda(s) sin cerrar en el/los período(s) ` +
        `${periods.join(
)}. Esa NetWin todavía no entró a la base: ` +
        `liquidar ahora paga de menos. Esperá a que el job de ` +
        `reconciliación las cierre (corre cada 10 min) o mandá force=true.`,
    );
    this.name = 'OpenRoundsInPeriodError';
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
