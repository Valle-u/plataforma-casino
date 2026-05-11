/**
 * DTOs para mint y burn.
 *
 * `amount` viene como string (numeric exacto). class-validator lo valida
 * con regex `^\d+(\.\d{1,2})?$` — entero positivo o con hasta 2 decimales.
 *
 * `reason` obligatorio (regla dura del doc).
 *
 * `referenceId` opcional: si el mint financia un bono/promo/jackpot, va
 * el UUID de esa entidad para join con reportes.
 */

import { IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

const AMOUNT_REGEX = /^(?!0+(?:\.0+)?$)\d+(?:\.\d{1,2})?$/;
const AMOUNT_MESSAGE =
  'amount debe ser un número positivo con hasta 2 decimales (ej. "100" o "100.50") y mayor a 0.';

export class MintDto {
  @IsString()
  @Matches(AMOUNT_REGEX, { message: AMOUNT_MESSAGE })
  amount!: string;

  @IsString()
  @MinLength(3, { message: 'reason debe tener al menos 3 caracteres.' })
  @MaxLength(500, { message: 'reason no puede tener más de 500 caracteres.' })
  reason!: string;

  @IsOptional()
  @IsUUID()
  referenceId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class BurnDto extends MintDto {}
