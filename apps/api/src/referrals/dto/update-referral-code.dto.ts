import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * DTO para renombrar / (des)activar una campaña de referido.
 *
 * Endpoint: PATCH /tenant/referrals/codes/:id (panel, referrals.view_own).
 * Ambos campos opcionales: se puede mandar solo `label`, solo `isActive`, o ambos.
 * No se puede borrar una campaña (solo desactivar) para conservar las métricas.
 */
export class UpdateReferralCodeDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'La etiqueta debe tener al menos 2 caracteres.' })
  @MaxLength(40, { message: 'La etiqueta no puede tener más de 40 caracteres.' })
  label?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
