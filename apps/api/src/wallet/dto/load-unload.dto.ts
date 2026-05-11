/**
 * DTOs para load y unload.
 *
 * Load: cajero/distribuidor/socio/admin transfiere fichas DESDE su wallet
 * HACIA otro user (típicamente jugador).
 *
 * Unload: el operador retira fichas DESDE el wallet de otro user HACIA el suyo.
 *
 * Reglas:
 *   - `targetUserId` requerido y debe ser UUID.
 *   - `amount` con formato regex (mismo que mint/burn).
 *   - `reason` OBLIGATORIO para unload (regla del doc §4), opcional para load.
 *   - `notes` opcional, hasta 1000 chars.
 *   - Anti-self lo valida el service: no se pueden transferir fichas a sí mismo.
 */

import { IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

const AMOUNT_REGEX = /^(?!0+(?:\.0+)?$)\d+(?:\.\d{1,2})?$/;
const AMOUNT_MESSAGE =
  'amount debe ser un número positivo con hasta 2 decimales (ej. "100" o "100.50") y mayor a 0.';

export class LoadDto {
  @IsUUID()
  targetUserId!: string;

  @IsString()
  @Matches(AMOUNT_REGEX, { message: AMOUNT_MESSAGE })
  amount!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class UnloadDto {
  @IsUUID()
  targetUserId!: string;

  @IsString()
  @Matches(AMOUNT_REGEX, { message: AMOUNT_MESSAGE })
  amount!: string;

  /** Obligatorio para unload (regla del doc §4). */
  @IsString()
  @MinLength(3, { message: 'reason debe tener al menos 3 caracteres para unload.' })
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
