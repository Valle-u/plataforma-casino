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
