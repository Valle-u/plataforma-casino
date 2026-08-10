/**
 * DTO para `PATCH /tenant/auth/me` (Parte A del plan perfil/wallet — docs/21).
 *
 * El user autenticado edita SU propio perfil. Todos los campos son opcionales
 * (PATCH idempotente). NO puede tocar: username (identificador), status
 * (solo operador), displayName (se deriva de firstName + lastName en el
 * service) ni password (endpoint específico `POST /me/password`).
 *
 * Email: el jugador lo edita con el mismo criterio que el operador (sin
 * verificación por ahora — el flujo de verificación queda pendiente; ver
 * docs/21). La unicidad la valida el service (409 si ya está en uso).
 */

import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateMyProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'firstName no puede quedar vacío.' })
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'lastName no puede quedar vacío.' })
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsEmail({}, { message: 'email inválido.' })
  email?: string;

  @IsOptional()
  @IsIn(['es'], {
    message: 'language debe ser: es.',
  })
  language?: string;
}
