/**
 * DTOs CRUD de `payment_methods`.
 *
 * `config` es jsonb libre — el shape específico (CBU, address, etc.) lo
 * sabe el frontend y los services downstream (deposits/withdrawals). Acá
 * solo validamos que sea un object.
 *
 * `code` regex: lowercase + dígitos + `_-`, empieza con letra/dígito,
 * longitud 2-50. Mismo pattern que bonus_definitions / promotions.
 */

import {
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
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
  @IsBoolean()
  isActive?: boolean;
}
