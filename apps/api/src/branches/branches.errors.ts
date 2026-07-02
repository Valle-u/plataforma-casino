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
