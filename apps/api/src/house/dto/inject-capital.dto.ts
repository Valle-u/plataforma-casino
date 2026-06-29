import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * Aporte de capital del dueño a la Casa (B-build-3). El monto se toma del
 * bank_tx referido (la plata real entrante) — acá sólo se elige cuál.
 */
export class InjectCapitalDto {
  /** Transferencia bancaria ENTRANTE (sin matchear) que respalda el aporte. */
  @IsUUID()
  bankTransactionId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
