import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';

/** Motor NetWin (C3): liquida comisiones de socios (fichas o plata real). */
export class SettleNetworkDto {
  /** IDs de filas commission_network_periods a liquidar. Alternativa a `period`. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  rowIds?: string[];

  /** 'YYYY-MM' o ISO: liquida TODAS las filas accrued del período. */
  @IsOptional()
  @IsString()
  period?: string;

  /** 'chips' (transfer Casa→socio) o 'cash' (plata real → quema de fichas). */
  @IsIn(['chips', 'cash'])
  method!: 'chips' | 'cash';

  /** Comprobante/referencia opcional de la transferencia (solo 'cash'). */
  @IsOptional()
  @IsString()
  reference?: string;
}
