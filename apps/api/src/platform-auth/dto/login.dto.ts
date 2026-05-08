/**
 * DTO (Data Transfer Object) del endpoint POST /platform/auth/login.
 *
 * class-validator usa los decoradores @IsEmail, @IsString, etc. para validar
 * automáticamente lo que llega en el body antes de entrar al controller.
 *
 * Si la validación falla → NestJS devuelve 400 Bad Request con detalle.
 *
 * El ValidationPipe global (ver main.ts) hace que esto funcione transparente.
 */

import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Email no válido.' })
  email!: string;

  @IsString()
  @MinLength(8, { message: 'La password debe tener al menos 8 caracteres.' })
  password!: string;
}
