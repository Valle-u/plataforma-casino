import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * Aporte de capital del dueño (B-build-3). El monto se toma del bank_tx referido
 * (la plata real entrante) — acá sólo se elige cuál.
 *
 * F5: si se pasa `operatorUserId` (socio indep con is_independent_branch=true),
 * el aporte va al bankroll de ese operador en vez de la Casa. Omitido/null →
 * comportamiento default (mintea a la Casa).
 */
export class InjectCapitalDto {
  /** Transferencia bancaria ENTRANTE (sin matchear) que respalda el aporte. */
  @IsUUID()
  bankTransactionId!: string;

  /**
   * F5 (opcional): socio indep destinatario del bankroll. Si se omite, mintea
   * a la Casa. Debe ser un user existente con is_independent_branch=true.
   */
  @IsOptional()
  @IsUUID()
  operatorUserId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
