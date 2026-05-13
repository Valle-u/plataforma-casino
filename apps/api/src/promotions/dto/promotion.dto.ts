/**
 * DTOs CRUD de `promotions`.
 *
 * `config`, `prizes`, `targetSegment`, `visibility` son JSONB libres.
 * Validación fina (e.g. probabilidades del wheel suman 100) la hace
 * cada service de type al usar.
 */

import {
  IsDateString,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export const PROMOTION_TYPES = [
  'lottery_tickets',
  'lottery_ranking',
  'missions',
  'daily_wheel',
  'login_streak',
  'level_chests',
] as const;

export const PROMOTION_STATUSES = [
  'draft',
  'scheduled',
  'active',
  'closed',
  'cancelled',
] as const;

export class CreatePromotionDto {
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

  @IsEnum(PROMOTION_TYPES)
  type!: (typeof PROMOTION_TYPES)[number];

  @IsOptional()
  @IsEnum(PROMOTION_STATUSES)
  status?: (typeof PROMOTION_STATUSES)[number];

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  prizes?: Record<string, unknown>;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsDateString()
  drawAt?: string;

  @IsOptional()
  @IsObject()
  targetSegment?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  visibility?: Record<string, unknown>;
}

export class UpdatePromotionDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsEnum(PROMOTION_STATUSES)
  status?: (typeof PROMOTION_STATUSES)[number];

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  prizes?: Record<string, unknown>;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsDateString()
  drawAt?: string;

  @IsOptional()
  @IsObject()
  targetSegment?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  visibility?: Record<string, unknown>;
}

