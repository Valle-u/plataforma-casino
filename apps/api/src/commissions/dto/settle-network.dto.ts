import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/** Motor NetWin (C3): liquida comisiones de socios SIEMPRE en plata real. */
export class SettleNetworkDto {
  /**
   * Liquidar aunque el período tenga rondas SIN CERRAR.
   *
   * Por defecto la liquidación se frena: una ronda abierta es NetWin que
   * todavía no entró a la base (C1/C4b), así que liquidar paga de menos.
   * `RoundsReconciliationCron` las cierra solas cada 10 minutos, así que lo
   * normal es esperar.
   *
   * Se manda `true` cuando el proveedor dejó una ronda trabada para siempre
   * y no se puede esperar más. Queda registrado en el audit log.
   */
  @IsOptional()
  @IsBoolean()
  force?: boolean;

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
