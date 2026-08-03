import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Matches,
} from 'class-validator';
import type { CorrectionReasonType } from '../employee-correction.service';

/**
 * Carga por corrección/reintegro del empleado de la red central (docs/19).
 * Requiere permiso `wallet.correct` + cupo mensual disponible.
 */
export class WalletCorrectDto {
  /** Cliente destino (obligatorio). No puede ser el propio actor ni la Casa. */
  @IsUUID('loose')
  targetUserId!: string;

  /** Monto > 0 con hasta 2 decimales. */
  @IsString()
  @Matches(/^(?!0+(?:\.0+)?$)\d+(?:\.\d{1,2})?$/, {
    message: 'Monto > 0 con hasta 2 decimales.',
  })
  amount!: string;

  /** Tipo de motivo (dropdown). 'bonus' quedó fuera: se gestiona por el flujo de bonos. */
  @IsIn(['correction', 'refund', 'other'] as CorrectionReasonType[])
  reasonType!: CorrectionReasonType;

  /**
   * Texto libre del motivo. Obligatorio si reasonType='other', opcional si no.
   * La validación cruzada la hace el service.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reasonNotes?: string;
}
