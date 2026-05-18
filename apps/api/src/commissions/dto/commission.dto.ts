/**
 * DTOs CRUD de `commission_rules`.
 *
 * `role` text libre (acepta los 6 roles del sistema + custom roles futuros).
 * `event_type` también text libre — MVP usa 'deposit_approved' y
 * 'withdrawal_paid' pero queda preparado para más.
 * `pct` decimal 0.00 a 100.00 (string para no perder precisión).
 */

import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Catálogo MVP. El service acepta cualquier string — esto es solo defensa
 * client-side via DTO. Si emerge un evento nuevo, sumar acá + hook en el
 * controller correspondiente (Sprint 25).
 */
export const KNOWN_EVENT_TYPES = [
  'deposit_approved',
  'withdrawal_paid',
] as const;

const PCT_REGEX = /^(?:100(?:\.00?)?|\d{1,2}(?:\.\d{1,2})?)$/;

export class CreateCommissionRuleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  role!: string;

  @IsString()
  @IsIn(KNOWN_EVENT_TYPES, {
    message: `eventType debe ser uno de: ${KNOWN_EVENT_TYPES.join(', ')}`,
  })
  eventType!: (typeof KNOWN_EVENT_TYPES)[number];

  @IsString()
  @Matches(PCT_REGEX, {
    message: 'pct debe ser 0.00 - 100.00 con hasta 2 decimales.',
  })
  pct!: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

export class UpdateCommissionRuleDto {
  @IsOptional()
  @IsString()
  @Matches(PCT_REGEX, {
    message: 'pct debe ser 0.00 - 100.00 con hasta 2 decimales.',
  })
  pct?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}
