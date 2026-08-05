import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * DTO de registro de suscripción web-push.
 *
 * Los campos los genera el browser al suscribirse:
 *   - `endpoint`: URL del push service para este dispositivo.
 *   - `p256dh` / `auth`: claves de cifrado (base64url).
 *   - `deviceLabel`: user-agent recortado (opcional, para UX).
 */
export class CreatePushSubscriptionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  endpoint!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  p256dh!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  auth!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  deviceLabel?: string;
}
