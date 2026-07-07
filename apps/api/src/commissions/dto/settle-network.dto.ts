import {
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/** Motor NetWin (C3): liquida comisiones de socios SIEMPRE en plata real. */
export class SettleNetworkDto {
  /** IDs de filas commission_network_periods a liquidar. Alternativa a `period`. */
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  rowIds?: string[];

  /** 'YYYY-MM' o ISO: liquida TODAS las filas accrued del período. */
  @IsOptional()
  @IsString()
  period?: string;

  /**
   * Comprobante/referencia opcional del pago. La comisión al socio se paga
   * SIEMPRE en plata real (la Casa quema el equivalente en fichas): el socio
   * dependiente no maneja fichas — sus cargas/retiros van por la tesorería y
   * el banco del tenant (docs/20). Ya no existe el método "fichas".
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;
}
