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
 * Carga por corrección/bonificación/reintegro del empleado (docs/19).
 * Requiere permiso `wallet.correct` + cupo mensual disponible.
 */
export class WalletCorrectDto {
  /** Cliente destino (obligatorio). No puede ser el propio actor ni la Casa. */
  @IsUUID()
  targetUserId!: string;

  /** Monto > 0 con hasta 2 decimales. */
  @IsString()
  @Matches(/^(?!0+(?:\.0+)?$)\d+(?:\.\d{1,2})?$/, {
    message: 'Monto > 0 con hasta 2 decimales.',
  })
  amount!: string;

  /** Tipo de motivo (dropdown). */
  @IsIn(['correction', 'bonus', 'refund', 'other'] as CorrectionReasonType[])
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
