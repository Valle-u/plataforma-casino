/**
 * DTO para `POST /tenant/users/:id/branch/toggle-independence`.
 *
 * El admin define si un socio opera como sucursal independiente. Si
 * `isIndependent=true`, `branchChipsPricePerUnit` es obligatorio. El CBU
 * (`branchBankAccount`) YA NO se manda en este DTO (2026-08-14) — el backend
 * lo resuelve solo del método de pago bancario que el socio ya tiene cargado
 * en su propio panel (ver `BranchesService.resolveBankAccountFromPaymentMethods`).
 * Si `isIndependent=false`, `branchChipsPricePerUnit` se ignora y el socio
 * vuelve a operar contra el banco del tenant.
 */

import { IsBoolean, IsNumberString, IsOptional } from 'class-validator';

export class ToggleIndependenceDto {
  @IsBoolean()
  isIndependent!: boolean;

  /**
   * Precio mayorista por ficha (numeric(10,4)). Ej: "1.0000" = paridad,
   * "0.9500" = 5% de descuento al socio. Requerido si isIndependent=true.
   */
  @IsOptional()
  @IsNumberString()
  branchChipsPricePerUnit?: string;

  /**
   * Solo para `isIndependent=false`: forzar la degradación aunque el
   * socio tenga estado operativo pendiente (bank_txs unmatched, bonos
   * definitions activas, fraud_links sin resolver).
   *
   * SAFE-BY-DEFAULT: si `force !== true` y hay pendientes, se rechaza
   * con 409 + lista de items pendientes. El admin decide si limpiar
   * primero (recomendado) o forzar (audit severity: critical).
   */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
