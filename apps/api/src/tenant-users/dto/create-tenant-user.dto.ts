import {
  ArrayMaxSize,
  IsArray,
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

  /**
   * Sprint 51.5: lista opcional de permission codes a otorgar como
   * overrides al user recién creado. Pensado para crear "empleados
   * a la carta" (el rol empleado no tiene defaults).
   *
   * Validaciones:
   *   - Cada code debe estar en el catálogo + ser delegable.
   *   - El actor debe tener TODOS los codes en su set efectivo.
   *   - Empleados-only no pueden delegar (sub-delegación bloqueada).
   *   - Si cualquiera falla, la transacción rollbackea (el user no se crea).
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  permissionOverrides?: string[];
}
