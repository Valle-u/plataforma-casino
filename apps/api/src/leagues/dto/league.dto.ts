/**
 * DTOs CRUD de `leagues`.
 *
 * `metric_config`, `prizes`, `visibility` son JSONB libres. Validación
 * fina (estructura de prizes, fórmula custom) se hace al settle/recompute.
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

export const LEAGUE_PERIODS = [
  'daily',
  'weekly',
  'monthly',
  'season',
  'custom',
] as const;

export const LEAGUE_METRICS = [
  'bet_volume',
  'rounds_count',
  'gross_won',
  'player_netwin',
  'score_custom',
] as const;

export const LEAGUE_STATUSES = ['scheduled', 'active', 'closed'] as const;

export class CreateLeagueDto {
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

  @IsEnum(LEAGUE_PERIODS)
  period!: (typeof LEAGUE_PERIODS)[number];

  @IsEnum(LEAGUE_METRICS)
  metric!: (typeof LEAGUE_METRICS)[number];

  @IsOptional()
  @IsObject()
  metricConfig?: Record<string, unknown>;

  /**
   * Premios por posición. Estructura libre — validamos al settle.
   * Ej: `{ "1": {...}, "2-5": {...}, "6-10": {...} }`.
   */
  @IsOptional()
  @IsObject()
  prizes?: Record<string, unknown>;

  @IsDateString()
  startsAt!: string;

  @IsDateString()
  endsAt!: string;

  /**
   * Sprint 51.8: opcional en el create — alineado con CreatePromotionDto
   * y CreateBonusDefinitionDto que también permiten setear status en el
   * mismo POST. Si no se pasa, el service decide el default (scheduled
   * o active según `startsAt` vs now).
   */
  @IsOptional()
  @IsEnum(LEAGUE_STATUSES)
  status?: (typeof LEAGUE_STATUSES)[number];

  @IsOptional()
  @IsObject()
  visibility?: Record<string, unknown>;
}

export class UpdateLeagueDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsEnum(LEAGUE_STATUSES)
  status?: (typeof LEAGUE_STATUSES)[number];

  @IsOptional()
  @IsObject()
  metricConfig?: Record<string, unknown>;

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
  @IsObject()
  visibility?: Record<string, unknown>;
}
