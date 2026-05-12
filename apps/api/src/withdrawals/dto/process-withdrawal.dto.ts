import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ProcessWithdrawalDto {
  /** Hash cripto, n° operación banco, etc. */
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  externalRef!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
