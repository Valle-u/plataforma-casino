import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * DTO para crear una campaña de referido.
 *
 * Endpoint: POST /tenant/referrals/codes (panel, referrals.view_own).
 * El `code` se auto-genera en el service; acá solo viaja la etiqueta interna.
 */
export class CreateReferralCodeDto {
  @IsString()
  @MinLength(2, { message: 'La etiqueta debe tener al menos 2 caracteres.' })
  @MaxLength(40, { message: 'La etiqueta no puede tener más de 40 caracteres.' })
  label!: string;
}
