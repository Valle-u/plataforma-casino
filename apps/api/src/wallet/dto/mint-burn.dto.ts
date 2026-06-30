/**
 * DTO de burn (destruir fichas del admin).
 *
 * El mint directo del admin se eliminó (las fichas solo se crean vía aporte
 * de capital a la Casa). Acá queda solo `BurnDto`.
 *
 * `amount` viene como string (numeric exacto), validado con regex. `reason`
 * obligatorio (regla dura). `referenceId` opcional para join con reportes.
 */

import {
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const AMOUNT_REGEX = /^(?!0+(?:\.0+)?$)\d+(?:\.\d{1,2})?$/;
const AMOUNT_MESSAGE =
  'amount debe ser un número positivo con hasta 2 decimales (ej. "100" o "100.50") y mayor a 0.';

export class BurnDto {
  @IsString()
  @Matches(AMOUNT_REGEX, { message: AMOUNT_MESSAGE })
  amount!: string;

  /**
   * Motivo del burn. Validación estricta porque destruye valor — el operador
   * debe escribir algo trackeable. Al menos 10 caracteres no-triviales.
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
