import {
  IsDateString,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UploadBankTransactionDto {
  /**
   * Sprint 53 (decisión dueño): opcional. El CBU/cuenta de origen deja de
   * ser obligatorio para transferencias salientes — el comprobante es la
   * única prueba. Para entrantes sigue usándose como matcher del deposit.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  bankAccount?: string;

  @IsNumberString()
  amount!: string;

  /**
   * Sprint 51: dirección. 'incoming' (default) = cliente al tenant
   * (respalda deposit). 'outgoing' = tenant al cliente (respalda withdrawal).
   */
  @IsOptional()
  @IsIn(['incoming', 'outgoing'])
  direction?: 'incoming' | 'outgoing';

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  /**
   * Sprint 54: titular de la cuenta propia del tenant usada en la
   * transferencia (entrante: la que recibe; saliente: con la que enviamos).
   * Se guarda por tx para listado/auditoría.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  accountHolder?: string;

  /** Sprint 54: nombre del banco de la cuenta propia usada. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  bankName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  senderName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  senderCbu?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reference?: string;

  /**
   * Sprint 52: comprobante de pago (URL + storage key). El service exige
   * ambos para direction='outgoing'. `receiptStorageKey` es el token de
   * dedupe: el mismo comprobante no puede cargarse dos veces.
   */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  receiptUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  receiptStorageKey?: string;

  /**
   * Sprint 55: SHA-256 del CONTENIDO del comprobante, calculado por el
   * server en `/upload-proof`. Es el token de dedupe real (el storage key
   * es un UUID random por upload y no alcanzaba): el MISMO archivo no puede
   * respaldar dos transferencias. Se guarda en `receipt_hash` con índice
   * único parcial como backstop.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  receiptHash?: string;

  @IsDateString()
  receivedAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class MatchBankTransactionDto {
  /**
   * Si true y el monto NO coincide exacto con el deposit, igual matchea.
   * Requiere `overrideReason` no vacío. Audit severity:high.
   */
  @IsOptional()
  override?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  overrideReason?: string;
}

export class UpdateBankTransactionStatusDto {
  @IsIn(['unmatched', 'matched', 'disputed'])
  status!: 'unmatched' | 'matched' | 'disputed';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

/**
 * Edición de una transferencia AÚN sin matchear. Todos los campos son
 * opcionales (patch parcial) — espeja los editables del upload. El service
 * rechaza la edición si la transferencia ya está matcheada. Los campos de
 * texto nullable se vacían mandando string vacío.
 */
export class UpdateBankTransactionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  bankAccount?: string;

  @IsOptional()
  @IsNumberString()
  amount?: string;

  @IsOptional()
  @IsIn(['incoming', 'outgoing'])
  direction?: 'incoming' | 'outgoing';

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  /**
   * Sprint 54: titular de la cuenta propia del tenant usada en la
   * transferencia (entrante: la que recibe; saliente: con la que enviamos).
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  accountHolder?: string;

  /** Sprint 54: nombre del banco de la cuenta propia usada. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  bankName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  senderName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  senderCbu?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  receiptUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  receiptStorageKey?: string;

  /** Sprint 55: SHA-256 del contenido del comprobante (dedupe real por archivo). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  receiptHash?: string;

  @IsOptional()
  @IsDateString()
  receivedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
