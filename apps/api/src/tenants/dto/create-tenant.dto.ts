/**
 * DTO para POST /platform/tenants — crear un tenant nuevo.
 *
 * Validaciones:
 *   - slug: lowercase, dígitos y guiones. Largo 3-30. Empieza con letra.
 *   - name: 1-200 chars.
 *   - planCode: string libre, validamos contra DB que exista.
 *   - contactEmail: email válido.
 *   - primaryDomain: hostname válido (sin puerto, sin protocolo).
 */

import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateTenantDto {
  @IsString()
  @Matches(/^[a-z][a-z0-9-]{2,29}$/, {
    message:
      'slug debe tener 3-30 chars, lowercase, empezar con letra y solo contener letras, dígitos y guiones.',
  })
  slug!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  planCode!: string;

  @IsEmail({}, { message: 'contactEmail debe ser un email válido.' })
  contactEmail!: string;

  @IsString()
  @Matches(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/, {
    message: 'primaryDomain debe ser un hostname válido (sin protocolo, sin puerto).',
  })
  @MaxLength(253)
  primaryDomain!: string;
}
