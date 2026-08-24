import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * DTO para el registro público de jugadores vía referral link.
 *
 * Endpoints: POST /tenant/auth/register (público, sin auth).
 *
 * Validaciones:
 *   - username: 3-30 chars, alfanumérico + guiones + underscores.
 *   - password: mínimo 8 chars.
 *   - displayName: 2-50 chars.
 *   - ageConfirmation: boolean, DEBE ser true.
 *   - consentDataProcessing: boolean, DEBE ser true.
 *   - ref: opcional, código de referido.
 *   - email: opcional, formato válido.
 *   - phone: opcional.
 *
 * Seguridad (docs/12):
 *   - Rate limit: 5 intentos / 15 min por IP (configurado en controller).
 *   - Age checkbox: obligatorio, almacena timestamp + IP (defensa legal).
 *   - Consent checkbox: obligatorio (Ley 25.326).
 */
export class TenantRegisterDto {
  @IsString()
  @MinLength(3, { message: 'El usuario debe tener al menos 3 caracteres.' })
  @MaxLength(30, { message: 'El usuario no puede tener más de 30 caracteres.' })
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'El usuario solo puede contener letras, números, guiones y guiones bajos.',
  })
  username!: string;

  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  @MaxLength(100)
  password!: string;

  @IsString()
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres.' })
  @MaxLength(50, { message: 'El nombre no puede tener más de 50 caracteres.' })
  displayName!: string;

  @IsOptional()
  @IsEmail({}, { message: 'El email no es válido.' })
  @MaxLength(100)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  ref?: string;

  @IsBoolean()
  ageConfirmation!: boolean;

  @IsBoolean()
  consentDataProcessing!: boolean;

  /**
   * Token de Cloudflare Turnstile (anti-bot). Opcional acá: solo se exige
   * cuando TURNSTILE_ENABLED=true. Validación en TurnstileService.
   */
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  turnstileToken?: string;
}
