import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';

/**
 * Fondeo de PRESUPUESTO (docs/16 §12).
 *
 * A diferencia de `InjectCapitalDto` (que se ata a una transferencia bancaria
 * y toma el monto de ahí), acá el admin fija el monto y el motivo directo. No
 * exige bank_tx. Requiere `reason` obligatorio (queda auditado con severity high).
 *
 * F5: si se pasa `operatorUserId` (socio indep con is_independent_branch=true),
 * el presupuesto va al bankroll de ese operador en vez de la Casa. Omitido/null
 * → comportamiento default (mintea a la Casa).
 *
 * D5: `idempotencyKey` OBLIGATORIA. Sin key, un retry del cliente (timeout de
 * red, doble click) generaría un `injectionId` nuevo por request → mint doble
 * a la wallet destino. Exigirla acá corta la fuga: si el cliente reintenta con
 * la misma key, `mintToWallet` devuelve la tx previa y `injectBudget` devuelve
 * la fila `house_capital_injections` existente sin dobles.
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

  /**
   * D5: idempotency key OBLIGATORIA. Generada por el cliente (uuid v4 típico)
   * al abrir el form. Un retry del mismo submit debe reusar la misma key para
   * que el mint no se doble. El backend valida UNIQUE en `wallet_transactions`
   * y devuelve la tx previa si coincide.
   */
  @IsString()
  @IsNotEmpty()
  @Length(1, 100)
  idempotencyKey!: string;

  /**
   * F5 (opcional): socio indep destinatario del bankroll. Si se omite, mintea
   * a la Casa. Debe ser un user existente con is_independent_branch=true.
   */
  @IsOptional()
  @IsUUID()
  operatorUserId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
