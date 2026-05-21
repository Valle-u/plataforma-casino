/**
 * DTO para `POST /tenant/auth/me/password` (Sprint 51.5).
 *
 * Cualquier user logueado cambia su propia password. Requiere
 * `currentPassword` para verificación + `newPassword` (≥8 chars).
 * Si tiene 2FA habilitada, además exige `twoFaCode`.
 */

import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ChangeMyPasswordDto {
  @IsString()
  @MinLength(1, { message: 'Tu password actual es requerida.' })
  @MaxLength(200)
  currentPassword!: string;

  @IsString()
  @MinLength(8, { message: 'Nueva password debe tener ≥ 8 caracteres.' })
  @MaxLength(72, { message: 'Nueva password debe tener ≤ 72 caracteres.' })
  newPassword!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'twoFaCode debe ser 6 dígitos.' })
  twoFaCode?: string;
}
