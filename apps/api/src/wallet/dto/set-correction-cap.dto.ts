import { IsString, Matches } from 'class-validator';

/**
 * Configura el cupo mensual de cargas por corrección de un empleado (docs/19).
 * Solo admin (permiso `users.edit`).
 */
export class SetCorrectionCapDto {
  /** Monto en fichas por mes. '0' = sin permiso implícito (aunque tenga wallet.correct). */
  @IsString()
  @Matches(/^\d+(?:\.\d{1,2})?$/, {
    message: 'Cupo >= 0 con hasta 2 decimales.',
  })
  cap!: string;
}
