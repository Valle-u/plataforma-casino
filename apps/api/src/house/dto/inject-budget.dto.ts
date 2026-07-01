import { IsOptional, IsString, MaxLength, MinLength, Matches } from 'class-validator';

/**
 * Fondeo de PRESUPUESTO a la Casa (docs/16 §12).
 *
 * A diferencia de `InjectCapitalDto` (que se ata a una transferencia bancaria
 * y toma el monto de ahí), acá el admin fija el monto y el motivo directo. No
 * exige bank_tx. Requiere `reason` obligatorio (queda auditado con severity high).
 */
export class InjectBudgetDto {
  /**
   * Monto en fichas (1 ficha = 1 peso). String con hasta 2 decimales, > 0.
   */
  @IsString()
  @Matches(/^(?!0+(?:\.0+)?$)\d+(?:\.\d{1,2})?$/, {
    message: 'Monto > 0 con hasta 2 decimales.',
  })
  amount!: string;

  /**
   * Motivo del fondeo — obligatorio. Ej.: "presupuesto julio 2026",
   * "reposición float empleados", "ajuste de operación".
   */
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
