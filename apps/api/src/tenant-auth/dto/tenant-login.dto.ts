import { IsOptional, IsString, Length, Matches, MinLength } from 'class-validator';

/**
 * Login del tenant: aceptamos username (no email obligatorio porque algunos
 * jugadores pueden no tener email).
 */
export class TenantLoginDto {
  @IsString()
  @MinLength(3)
  username!: string;

  @IsString()
  @MinLength(8, { message: 'La password debe tener al menos 8 caracteres.' })
  password!: string;

  /**
   * Código TOTP opcional. Si el user tiene 2FA enabled, ESTE campo es
   * obligatorio — el service lo valida después de password. Si el user
   * NO tiene 2FA, este campo se ignora.
   */
  @IsOptional()
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, { message: 'twoFaCode debe ser 6 dígitos.' })
  twoFaCode?: string;
}
