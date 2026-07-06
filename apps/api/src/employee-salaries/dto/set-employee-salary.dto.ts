import {
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Body de `PUT /tenant/employees/:userId/salary`.
 *
 * Estructura del monto:
 *   - `monthlyAmount`: número. 0 significa "sin sueldo" explícito. Tope alto
 *     (1e12) puramente defensivo — la DB tiene numeric(20,2), pero un
 *     input humano por encima de eso casi seguro es un error tipográfico.
 *   - `currency`: opcional. Por defecto 'ARS'. Se enforce a 3 chars uppercase
 *     (ISO 4217 like) para evitar chatarra tipo "$" o "arg".
 *   - `notes`: nota libre del admin, ≤ 1000 chars. Opcional.
 */
export class SetEmployeeSalaryDto {
  @IsNumber({ maxDecimalPlaces: 2 }, {
    message: 'monthlyAmount debe ser numérico con máximo 2 decimales.',
  })
  @Min(0, { message: 'monthlyAmount no puede ser negativo.' })
  @Max(1e12, { message: 'monthlyAmount excede el máximo permitido.' })
  monthlyAmount!: number;

  @IsOptional()
  @IsString()
  @Length(3, 3, { message: 'currency debe ser un código ISO de 3 letras (ej. ARS).' })
  @Matches(/^[A-Z]{3}$/, {
    message: 'currency debe estar en mayúsculas (ej. ARS, USD).',
  })
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
