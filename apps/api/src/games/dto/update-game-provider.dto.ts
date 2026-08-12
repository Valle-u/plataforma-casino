import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Patch de flags operativos de un proveedor. Las credenciales NO se tocan
 * acá (van por PATCH /tenant/settings/:key, validadas por el registry).
 */
export class UpdateGameProviderDto {
  /** Master switch del proveedor. */
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  /** Modo mantenimiento (apaga todos sus juegos). */
  @IsOptional()
  @IsBoolean()
  maintenanceMode?: boolean;
}
