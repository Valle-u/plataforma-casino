/**
 * DTOs para el retiro EN NOMBRE de un jugador (operador que registra el
 * retiro de un jugador que no supo hacer la solicitud self-service).
 *
 * - `CreateOnBehalfWithdrawalDto`: crea el retiro pendiente (entra a la cola
 *   normal; se paga después con el flujo existente).
 * - `CreateOnBehalfPaidWithdrawalDto`: además paga en un paso — declara la
 *   transferencia saliente ejecutada (con comprobante obligatorio, Sprint 52),
 *   la matchea y quema las fichas (E6). Extiende los campos de pago de
 *   PayInFullWithdrawalDto.
 *
 * El resultado es un retiro REAL (type 'withdrawal' + burn), no un unload
 * manual — así cuenta como retiro en las estadísticas de pago.
 */
import {
  IsBoolean,
  IsDateString,
  IsNotEmptyObject,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateOnBehalfWithdrawalDto {
  /** El jugador (usuario_final) al que se le registra el retiro. */
  @IsUUID()
  targetUserId!: string;

  /** Método de pago (transferencia) del tenant. */
  @IsUUID()
  methodId!: string;

  /** Monto en fichas a retirar del wallet del jugador. */
  @IsNumberString()
  amountChips!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(10)
  currencyFiat!: string;

  /** Datos de destino del pago (CBU/alias del jugador). */
  @IsObject()
  @IsNotEmptyObject()
  targetAccount!: Record<string, unknown>;

  /** Motivo (queda en audit log). Ej: "El jugador no sabe hacer la solicitud". */
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class CreateOnBehalfPaidWithdrawalDto extends CreateOnBehalfWithdrawalDto {
  /** CBU/cuenta de origen (opcional, Sprint 53: con el comprobante alcanza). */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  bankAccount?: string;

  /** Monto REAL transferido (fiat). Si difiere del amount_fiat, exige override. */
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

  /** URL del comprobante subido (upload-proof). OBLIGATORIO (Sprint 52). */
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  receiptUrl!: string;

  /** Storage key del comprobante (upload-proof). OBLIGATORIO — token de dedupe. */
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  receiptStorageKey!: string;

  /** SHA-256 del comprobante (server-side en upload-proof). Dedupe por archivo. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  receiptHash?: string;

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
