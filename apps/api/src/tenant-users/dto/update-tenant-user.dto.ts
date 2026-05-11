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
  @IsOptional()
  @IsIn(['active', 'suspended', 'banned', 'pending'], {
    message: "status debe ser uno de: active, suspended, banned, pending.",
  })
  status?: 'active' | 'suspended' | 'banned' | 'pending';

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  displayName?: string;

  @IsOptional()
  @IsEmail({}, { message: 'email inválido.' })
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;
}
