/**
 * DTO para `POST /tenant/users/:id/branch/toggle-independence`.
 *
 * El admin define si un socio opera como sucursal independiente. Si
 * `isIndependent=true`, deben venir también `branchBankAccount` y
 * `branchChipsPricePerUnit`. Si `false`, los otros campos se ignoran y
 * el socio vuelve a operar contra el banco del tenant.
 */

import { IsBoolean, IsNumberString, IsOptional, IsString, MaxLength } from 'class-validator';

export class ToggleIndependenceDto {
  @IsBoolean()
  isIndependent!: boolean;

  /** CBU/alias del banco propio del socio. Requerido si isIndependent=true. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  branchBankAccount?: string;

  /**
   * Precio mayorista por ficha (numeric(10,4)). Ej: "1.0000" = paridad,
   * "0.9500" = 5% de descuento al socio. Requerido si isIndependent=true.
   */
  @IsOptional()
  @IsNumberString()
  branchChipsPricePerUnit?: string;
}
