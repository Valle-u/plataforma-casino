import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateTenantUserDto {
  @IsString()
  @Matches(/^[a-z0-9._-]{3,30}$/, {
    message: 'username 3-30 chars (lowercase, dígitos, ._-).',
  })
  username!: string;

  @IsString()
  @MinLength(8, { message: 'password ≥ 8 chars.' })
  @MaxLength(72)
  password!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  displayName!: string;

  @IsOptional()
  @IsEmail({}, { message: 'email inválido.' })
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  /** Code del rol a asignar (admin_tenant, socio, distribuidor, cajero, empleado, usuario_final). */
  @IsString()
  @MaxLength(50)
  roleCode!: string;
}
