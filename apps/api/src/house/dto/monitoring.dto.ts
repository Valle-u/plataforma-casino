/**
 * DTOs de query para los endpoints de monitoreo de la Casa / socio indep.
 *
 *   - StockAlertStatusQueryDto: GET /tenant/house/stock-alert-status
 *   - CapitalNeededQueryDto: GET /tenant/house/capital-needed
 *
 * Ambos aceptan `operatorUserId` opcional: si viene, el cálculo se hace
 * sobre la wallet + sub-red de ese operador (socio indep). Si no, se
 * calcula sobre la Casa y su red admin (todos los users que NO cuelgan
 * de un socio indep).
 */

import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class StockAlertStatusQueryDto {
  /**
   * Si viene, chequea la wallet del socio indep (`is_independent_branch=true`).
   * Si se omite, chequea la Casa (`__casa__`).
   */
  @IsOptional()
  @IsUUID()
  operatorUserId?: string;
}

export class CapitalNeededQueryDto {
  /** Ventana en días para agregar depósitos/retiros. Default 30, máx 365. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;

  /**
   * Si viene, calcula la exposición de la sub-red del socio indep. Si se
   * omite, la Casa y su red admin.
   */
  @IsOptional()
  @IsUUID()
  operatorUserId?: string;
}
