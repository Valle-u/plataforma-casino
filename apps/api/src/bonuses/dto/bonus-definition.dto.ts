/**
 * DTOs para CRUD de `bonus_definitions`.
 *
 * `config`, `wagering`, `segmentFilter`, `visibility` son JSONB libres
 * en DB. El controller acepta cualquier objeto serializable; la
 * validación fina (que `matchPct` esté en [0,100], etc.) se hará en
 * sprints siguientes cuando los flujos auto-grant la necesiten. Hoy
 * solo guardamos lo que llega.
 */

import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const BONUS_TYPES = [
  'welcome',
  'reload',
  'cashback',
  'manual',
  'free_spins',
  'no_deposit',
  'referral',
] as const;

export const BONUS_DEFINITION_STATUSES = [
  'draft',
  'active',
  'paused',
  'archived',
] as const;

export class CreateBonusDefinitionDto {
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9_-]{1,49}$/, {
    message:
      'code debe ser lowercase, empezar con letra/dígito, longitud 2-50, solo [a-z0-9_-].',
  })
  code!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(120)
  name!: string;

  @IsEnum(BONUS_TYPES)
  type!: (typeof BONUS_TYPES)[number];

  @IsOptional()
  @IsEnum(BONUS_DEFINITION_STATUSES)
  status?: (typeof BONUS_DEFINITION_STATUSES)[number];

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  wagering?: Record<string, unknown>;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650) // ~10 años, sanidad
  expirationDays?: number;

  @IsOptional()
  @IsObject()
  segmentFilter?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  visibility?: Record<string, unknown>;
}

export class UpdateBonusDefinitionDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsEnum(BONUS_DEFINITION_STATUSES)
  status?: (typeof BONUS_DEFINITION_STATUSES)[number];

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  wagering?: Record<string, unknown>;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  expirationDays?: number;

  @IsOptional()
  @IsObject()
  segmentFilter?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  visibility?: Record<string, unknown>;
}
