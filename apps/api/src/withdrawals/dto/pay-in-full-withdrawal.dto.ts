/**
 * PayInFullWithdrawalDto — payload del endpoint compuesto "pago completo"
 * (Fase 2 mobile). En UNA operación el operador financiero declara la
 * transferencia saliente YA ejecutada, la matchea con el retiro y lo marca
 * como pagado.
 *
 * Espeja los campos de UploadBankTransactionDto (direction='outgoing') más
 * el override del MatchBankTransactionDto.
 *
 * Sprint 52 (decisión dueño): el COMPROBANTE es obligatorio y reemplaza a
 * la referencia bancaria manual (campo eliminado). El cliente primero sube
 * el archivo por `POST /tenant/bank-transactions/upload-proof` (flujo
 * two-step, igual que deposits) y acá envía `receiptUrl` + `receiptStorageKey`.
 * `paidExternalRef` se auto-genera en el backend — no se recibe nada manual.
 */
import {
  IsBoolean,
  IsDateString,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class PayInFullWithdrawalDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  bankAccount!: string;

  /**
   * Monto REAL transferido (fiat). Si difiere del amount_fiat del retiro
   * (comisiones bancarias, redondeo), el match exige `override` + motivo.
   */
  @IsNumberString()
  amount!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  /** Fecha/hora en que se ejecutó la transferencia. */
  @IsDateString()
  receivedAt!: string;

  /** Destinatario del pago (opcional, metadata). */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  senderName?: string;

  /** URL del comprobante subido (upload-proof). OBLIGATORIO. */
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  receiptUrl!: string;

  /**
   * Storage key del comprobante (upload-proof). OBLIGATORIO — además de
   * regenerar signed URLs, es el token de dedupe: el mismo comprobante no
   * puede usarse en dos transferencias (sustituye al bankReference).
   */
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  receiptStorageKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  /** True si el monto transferido NO coincide exacto con el amount_fiat. */
  @IsOptional()
  @IsBoolean()
  override?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  overrideReason?: string;
}
