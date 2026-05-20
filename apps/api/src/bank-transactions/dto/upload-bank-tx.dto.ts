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
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  bankAccount!: string;

  @IsNumberString()
  amount!: string;

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
  @MaxLength(100)
  bankReference?: string;

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
