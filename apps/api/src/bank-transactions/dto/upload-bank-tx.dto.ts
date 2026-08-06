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

  @IsOptional()
  @IsDateString()
  receivedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
