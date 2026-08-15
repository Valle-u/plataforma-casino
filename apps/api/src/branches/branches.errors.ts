/**
 * Errores del dominio branches (Sprint 51 — sucursales independientes).
 */

export class BranchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class BranchSocioNotFoundError extends BranchError {
  constructor(public readonly userId: string) {
    super(`User ${userId} no existe.`);
  }
}

export class BranchNotASocioError extends BranchError {
  constructor(public readonly userId: string) {
    super(`User ${userId} no tiene rol 'socio'. El modo sucursal independiente solo aplica a socios.`);
  }
}

export class BranchNotIndependentError extends BranchError {
  constructor(public readonly userId: string) {
    super(`User ${userId} no está marcado como sucursal independiente. Activá el modo antes de venderle fichas.`);
  }
}

export class BranchInvalidPriceError extends BranchError {
  constructor(public readonly price: string) {
    super(`Precio mayorista inválido: "${price}". Debe ser > 0.`);
  }
}

export class BranchPriceNotConfiguredError extends BranchError {
  constructor(public readonly userId: string) {
    super(`Sucursal ${userId} no tiene precio mayorista configurado. Editá la config antes de vender fichas.`);
  }
}

/**
 * Se lanza al activar independencia si el socio no tiene un método de pago
 * bancario propio y activo cargado (payment_methods, type='bank_transfer',
 * ownerId=socioId). Desde 2026-08-14 el CBU de aislamiento ya NO lo tipea
 * el admin a mano — se toma del método de pago que el socio ya carga en su
 * propio panel (/my-branch). Sin eso, no hay CBU con el que aislar sus
 * transferencias bancarias del resto del tenant.
 */
export class BranchNoBankPaymentMethodError extends BranchError {
  constructor(public readonly userId: string) {
    super(
      `El socio ${userId} no tiene un método de pago bancario (CBU/alias) cargado en su panel. Pedile que cargue uno en "Mis métodos de pago" antes de activar independencia.`,
    );
  }
}

/**
 * Se lanza al intentar degradar un socio independiente que todavía tiene
 * estado operativo activo (bank_txs unmatched, bonus_defs activas, fraud
 * links sin resolver). El admin debe (a) limpiar/resolver esos items
 * primero, o (b) forzar con `force: true` en el DTO (audit severity high).
 *
 * El payload incluye los conteos por categoría para que el frontend
 * muestre exactamente qué está pendiente.
 */
export class BranchDegradeBlockedError extends BranchError {
  constructor(
    public readonly userId: string,
    public readonly pending: {
      bankTxsUnmatched: number;
      bonusDefsActive: number;
      fraudLinksUnresolved: number;
    },
  ) {
    const items = [
      pending.bankTxsUnmatched > 0
        ? `${pending.bankTxsUnmatched} transferencia(s) sin matchear`
        : null,
      pending.bonusDefsActive > 0
        ? `${pending.bonusDefsActive} definición(es) de bono activas`
        : null,
      pending.fraudLinksUnresolved > 0
        ? `${pending.fraudLinksUnresolved} link(s) antifraude sin resolver`
        : null,
    ].filter((s): s is string => s !== null);
    super(
      `El socio ${userId} tiene estado operativo activo que quedaría visible para el admin si se degrada: ${items.join(', ')}. Limpialos antes o pasá force: true para degradar igual (auditado).`,
    );
  }
}

/**
 * Se lanza al intentar cambiar el modo de un socio (dep↔indep) cuando su
 * sub-red tiene depósitos o retiros IN-FLIGHT (sin resolver). El flip cambiaría
 * quién banca a mitad de camino, dejando esas solicitudes apuntando a un issuer
 * contradictorio (los depósitos resuelven el issuer al aprobar; los retiros lo
 * congelan al crear). Es un bloqueo DURO (no bypasseable con force): primero hay
 * que aprobar/rechazar las solicitudes. Ver docs/17 §14.1.
 */
export class BranchFlipHasPendingRequestsError extends BranchError {
  constructor(
    public readonly userId: string,
    public readonly pending: {
      depositsPending: number;
      withdrawalsPending: number;
    },
  ) {
    const items = [
      pending.depositsPending > 0
        ? `${pending.depositsPending} depósito(s) pendiente(s)`
        : null,
      pending.withdrawalsPending > 0
        ? `${pending.withdrawalsPending} retiro(s) pendiente(s)`
        : null,
    ].filter((s): s is string => s !== null);
    super(
      `El socio ${userId} tiene ${items.join(' y ')} en su sub-red. Resolvé (aprobá o rechazá) esas solicitudes antes de cambiar el modo — un flip a mitad de camino dejaría el respaldo inconsistente.`,
    );
  }
}

/**
 * Se lanza al intentar volver un socio a DEPENDIENTE cuando ya se independizó
 * en el MISMO período de comisión. El modelo de ventaneo (§14.4) usa dos
 * timestamps y no puede representar dos tramos dependientes en un mismo mes, así
 * que un doble flip (dep→indep→dep) perdería la comisión del primer tramo. Es un
 * bloqueo DURO: el admin debe esperar al cierre del período (ahí el compute
 * mensual captura bien el tramo dependiente). Ver docs/17 §14.4.
 */
export class BranchFlipSamePeriodError extends BranchError {
  constructor(
    public readonly userId: string,
    public readonly independizedAt: Date,
  ) {
    super(
      `El socio ${userId} ya se independizó este período (el ${independizedAt.toISOString().slice(0, 10)}). Volverlo dependiente ahora perdería la comisión de su tramo dependiente del mes. Esperá al cierre del período — el cómputo mensual la liquida bien.`,
    );
  }
}
