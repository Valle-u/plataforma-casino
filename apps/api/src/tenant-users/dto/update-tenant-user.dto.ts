import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
/**
 * UpdateTenantUserDto — todos los campos opcionales.
 *
 * Si el body viene vacío, devolvemos el user sin cambios (idempotente).
 * Para banear: { status: 'banned' }.
 * Para suspender: { status: 'suspended' }.
 * Para reactivar: { status: 'active' }.
 */
export class UpdateTenantUserDto {
  // 'pending' se quitó de la UI y de los valores aceptados (no hay flujo que
  // lo use). Sigue en el enum de la DB por si se retoma un gate de KYC/activación.
  @IsOptional()
  @IsIn(['active', 'suspended', 'banned', 'inactive'], {
    message: 'status debe ser uno de: active, suspended, banned, inactive.',
  })
  status?: 'active' | 'suspended' | 'banned' | 'inactive';

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsIn(['es'], {
    message: 'language debe ser: es.',
  })
  language?: string;

  @IsOptional()
  @IsEmail({}, { message: 'email inválido.' })
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;
}
