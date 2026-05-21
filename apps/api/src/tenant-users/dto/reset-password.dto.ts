/**
 * DTO para `POST /tenant/users/:userId/reset-password` (Sprint 51.4).
 *
 * Un user con `users.reset_password` puede resetear la password de
 * cualquier user en su downstream (validado por ScopeGuard). El admin
 * bypasea scope. Si el rol del actor `requiresTwoFa=true` y tiene 2FA
 * habilitada, debe enviar `twoFaCode` válido.
 */

import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  @MinLength(8, { message: 'Nueva password debe tener ≥ 8 caracteres.' })
  @MaxLength(72, { message: 'Nueva password debe tener ≤ 72 caracteres.' })
  newPassword!: string;

  /**
   * Código TOTP del actor — obligatorio si el rol del actor exige 2FA y
   * el actor lo tiene habilitado. El controller chequea condicionalmente.
   */
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'twoFaCode debe ser 6 dígitos.' })
  twoFaCode?: string;

  /** Motivo opcional para el audit log. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
