import { IsString, MinLength } from 'class-validator';

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
}
