import { IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

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

  /**
   * Recovery code one-time, alternativa a `twoFaCode` cuando el user perdió
   * su app TOTP. Formato `xxxx-xxxx-xx` (10 hex chars, opcional con guiones).
   * Si el code matchea uno vigente, queda invalidado tras este login.
   *
   * Validación laxa de shape (3-32 chars) — el service hace la
   * normalización fina (strip guiones, lowercase) y rechaza si la forma
   * normalizada no es exactamente 10 hex chars.
   */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(32)
  recoveryCode?: string;
}
