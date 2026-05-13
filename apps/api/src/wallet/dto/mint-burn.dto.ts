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

import { IsOptional, IsString, IsUUID, Length, Matches, MaxLength, MinLength } from 'class-validator';

const AMOUNT_REGEX = /^(?!0+(?:\.0+)?$)\d+(?:\.\d{1,2})?$/;
const AMOUNT_MESSAGE =
  'amount debe ser un número positivo con hasta 2 decimales (ej. "100" o "100.50") y mayor a 0.';

export class MintDto {
  @IsString()
  @Matches(AMOUNT_REGEX, { message: AMOUNT_MESSAGE })
  amount!: string;

  /**
   * Motivo del mint/burn. Validación deliberadamente estricta porque
   * es una operación que crea o destruye valor — el cajero debe escribir
   * algo trackeable, no "abc". Al menos 10 caracteres no-trivial.
   *
   * Trade-off: si el operador es legítimo y solo está testeando, va a
   * sentirlo molesto. Pero el costo de un audit con motivos basura es
   * peor (auditoría inútil).
   */
  @IsString()
  @MinLength(10, { message: 'reason debe tener al menos 10 caracteres descriptivos.' })
  @MaxLength(500, { message: 'reason no puede tener más de 500 caracteres.' })
  @Matches(/[a-zA-Z]{3,}/, {
    message: 'reason debe contener al menos 3 letras consecutivas (no solo símbolos/dígitos).',
  })
  reason!: string;

  @IsOptional()
  @IsUUID()
  referenceId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  /**
   * Código TOTP del actor. Si el admin tiene 2FA enabled, este campo es
   * obligatorio (el handler tira 400 TWO_FA_REQUIRED si falta). Si no
   * tiene 2FA, se ignora.
   */
  @IsOptional()
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, { message: 'twoFaCode debe ser 6 dígitos.' })
  twoFaCode?: string;
}

export class BurnDto extends MintDto {}
