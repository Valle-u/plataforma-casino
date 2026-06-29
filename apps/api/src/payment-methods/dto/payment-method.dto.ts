/**
 * DTOs CRUD de `payment_methods`.
 *
 * `config` es jsonb libre — el shape específico (CBU, address, etc.) lo
 * sabe el frontend y los services downstream (deposits/withdrawals). Acá
 * solo validamos que sea un object.
 *
 * `chipsPerUnit` (Parte B): fichas por unidad de la moneda del método. Ratio
 * ficha↔plata usado en depósito/retiro. Default 1 (1 ficha = 1 peso).
 *
 * `code` regex: lowercase + dígitos + `_-`, empieza con letra/dígito,
 * longitud 2-50. Mismo pattern que bonus_definitions / promotions.
 */

import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const PAYMENT_METHOD_TYPES = [
  'bank_transfer',
  'crypto',
  'other',
] as const;

export class CreatePaymentMethodDto {
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

  @IsEnum(PAYMENT_METHOD_TYPES)
  type!: (typeof PAYMENT_METHOD_TYPES)[number];

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  /** Fichas por unidad de la moneda del método. Default 1. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  @Max(1_000_000)
  chipsPerUnit?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePaymentMethodDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  @Max(1_000_000)
  chipsPerUnit?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
