/**
 * DTOs del módulo responsible-gaming.
 *
 * Convención: amounts como string (numeric chips). `null` explícito quita
 * el límite. `undefined` (no enviado) deja el valor previo intacto.
 *
 * El backend re-valida acá lo que ya valida el service — defensa en
 * profundidad para que los errores de input lleguen como 400 limpio antes
 * de tocar DB.
 */

import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const AMOUNT_REGEX = /^\d{1,18}(?:\.\d{1,2})?$/;

class NullableAmountDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Matches(AMOUNT_REGEX, { message: 'Monto inválido (positivo, ≤2 decimales).' })
  value?: string | null;
}

/**
 * PATCH /play/limits y PUT /tenant/users/:id/limits — todos opcionales.
 * Pasar `null` explícito para QUITAR un límite. Omitir = no tocar.
 */
export class UpsertLimitsDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Matches(AMOUNT_REGEX)
  depositLimitDaily?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Matches(AMOUNT_REGEX)
  depositLimitWeekly?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Matches(AMOUNT_REGEX)
  depositLimitMonthly?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Matches(AMOUNT_REGEX)
  betLimitPerRound?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Matches(AMOUNT_REGEX)
  lossLimitPeriod?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsEnum(['day', 'week', 'month'], {
    message: 'lossLimitPeriodUnit debe ser day|week|month.',
  })
  lossLimitPeriodUnit?: 'day' | 'week' | 'month' | null;

  /** Solo admin lo setea — el player no debería poder mentir su edad. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(18)
  @Max(120)
  ageConfirmedMin?: number | null;

  /** Razón obligatoria si actor es admin. El controller la enforce. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  // Suprimir warning unused para clase placeholder.
   
  _unused?: NullableAmountDto;
}

export class CreateExclusionDto {
  @IsEnum(['cool_off', 'temporary', 'permanent'], {
    message: 'type debe ser cool_off|temporary|permanent.',
  })
  type!: 'cool_off' | 'temporary' | 'permanent';

  /**
   * ISO date. Requerido para cool_off/temporary. Para permanent se ignora
   * (backend lo fuerza a null).
   */
  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class RevokeExclusionDto {
  @IsString()
  @MaxLength(500)
  reason!: string;
}
