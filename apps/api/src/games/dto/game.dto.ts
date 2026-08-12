/**
 * DTOs CRUD del catálogo de games.
 *
 * `code` lowercase + snake. `config` jsonb libre — el provider lo
 * interpreta. La validación específica del shape la haría el provider
 * adapter cuando llegue (Sprint 35).
 */

import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const CODE_REGEX = /^[a-z0-9][a-z0-9_]{1,49}$/;

export const GAME_CATEGORIES = ['slots', 'live', 'crash', 'table', 'mini'] as const;

export class CreateGameDto {
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  @Matches(CODE_REGEX, {
    message:
      'code lowercase + dígitos + _ (debe empezar con letra/dígito).',
  })
  code!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  providerCode?: string;

  @IsEnum(GAME_CATEGORIES)
  category!: (typeof GAME_CATEGORIES)[number];

  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  thumbnailUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  shortDescription?: string | null;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  featured?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Override manual: oculto del lobby (abrible por link directo). */
  @IsOptional()
  @IsBoolean()
  isHidden?: boolean;

  /** Override manual: deshabilitado (bloqueado, no se puede abrir). */
  @IsOptional()
  @IsBoolean()
  isDisabled?: boolean;
}

export class UpdateGameDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  thumbnailUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  shortDescription?: string | null;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  featured?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Override manual: oculto del lobby (abrible por link directo). */
  @IsOptional()
  @IsBoolean()
  isHidden?: boolean;

  /** Override manual: deshabilitado (bloqueado, no se puede abrir). */
  @IsOptional()
  @IsBoolean()
  isDisabled?: boolean;
}

/** Body de POST /tenant/games/bulk — flags sobre varios juegos. */
export class BulkGamesDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids!: string[];

  @IsOptional()
  @IsBoolean()
  isHidden?: boolean;

  @IsOptional()
  @IsBoolean()
  isDisabled?: boolean;

  @IsOptional()
  @IsBoolean()
  featured?: boolean;
}
