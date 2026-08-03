/**
 * DTOs para grant manual / cancel / force-clear.
 *
 * `amount` viene como string (numeric exacto). Misma validación que
 * mint/burn — entero positivo con hasta 2 decimales, > 0.
 */

import { IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

const AMOUNT_REGEX = /^(?!0+(?:\.0+)?$)\d+(?:\.\d{1,2})?$/;
const AMOUNT_MESSAGE =
  'amount debe ser un número positivo con hasta 2 decimales (ej. "100" o "100.50") y mayor a 0.';

/**
 * Grant manual: el cajero/admin elige user, monto, motivo. El sistema
 * resuelve el funder (admin del bono) y debita.
 */
export class GrantBonusDto {
  @IsUUID('loose')
  userId!: string;

  /**
   * ID de la `bonus_definitions` a usar. La definition debe estar en
   * status='active'.
   */
  @IsUUID('loose')
  definitionId!: string;

  @IsString()
  @Matches(AMOUNT_REGEX, { message: AMOUNT_MESSAGE })
  amount!: string;

  /**
   * Motivo obligatorio (regla §A6 del doc — "manual: motivo obligatorio").
   * Validación estricta para evitar abuso de cajero ("test", "abc").
   */
  @IsString()
  @MinLength(10, { message: 'reason debe tener al menos 10 caracteres descriptivos.' })
  @MaxLength(500)
  @Matches(/[a-zA-Z]{3,}/, {
    message: 'reason debe contener al menos 3 letras consecutivas.',
  })
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  /**
   * Source event libre. Si no se manda, default = { kind: 'manual' }.
   * Útil cuando un servicio llama internamente con metadata extra.
   */
  @IsOptional()
  @IsObject()
  sourceEvent?: Record<string, unknown>;
}

export class CancelBonusDto {
  @IsString()
  @MinLength(10, { message: 'reason debe tener al menos 10 caracteres descriptivos.' })
  @MaxLength(500)
  @Matches(/[a-zA-Z]{3,}/, {
    message: 'reason debe contener al menos 3 letras consecutivas.',
  })
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class ForceClearBonusDto {
  @IsString()
  @MinLength(10, { message: 'reason debe tener al menos 10 caracteres descriptivos.' })
  @MaxLength(500)
  @Matches(/[a-zA-Z]{3,}/, {
    message: 'reason debe contener al menos 3 letras consecutivas.',
  })
  reason!: string;

  /**
   * Código TOTP 2FA — `force_clear` es operación destructiva (libera
   * fichas del bonus al wallet real). Exige step-up auth.
   */
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'twoFaCode debe ser 6 dígitos.' })
  twoFaCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

/**
 * Débito manual de bono: el cajero/admin saca fichas del `bonus_balance`
 * del jugador (monto arbitrario, no atado a una planilla). El reverso
 * vuelve al funder original / Casa (LEYES E3/B4, docs/15 §Reverso).
 *
 * Espejo de `GrantBonusDto` sin `definitionId`.
 */
export class RemoveBonusDto {
  @IsUUID('loose')
  userId!: string;

  @IsString()
  @Matches(AMOUNT_REGEX, { message: AMOUNT_MESSAGE })
  amount!: string;

  @IsString()
  @MinLength(10, { message: 'reason debe tener al menos 10 caracteres descriptivos.' })
  @MaxLength(500)
  @Matches(/[a-zA-Z]{3,}/, {
    message: 'reason debe contener al menos 3 letras consecutivas.',
  })
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
