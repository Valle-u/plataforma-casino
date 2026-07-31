/**
 * DTO para `POST /tenant/users/:id/branch/sell-chips`.
 *
 * El admin "vende" fichas al socio independiente: transfer desde la Casa
 * (stock de la Casa, LEYES E3) al wallet del socio.
 *
 * `amountChips` es el monto de fichas a transferir. `amountFiat` es el total
 * que se le cobra al socio por la operación: si viene, el precio por ficha se
 * calcula como `pricePerUnit = amountFiat / amountChips`; si no viene, se usa
 * el `branchChipsPricePerUnit` configurado del socio (comportamiento legacy).
 */

import { IsNumberString, IsOptional, IsString, MaxLength } from 'class-validator';

export class SellChipsDto {
  @IsNumberString()
  amountChips!: string;

  /** Total $ que se le cobra al socio por la operación. Opcional: si no
   *  viene, el backend usa el precio configurado del socio. */
  @IsOptional()
  @IsNumberString()
  amountFiat?: string;

  /** Idempotency key opcional — el header X-Idempotency-Key lo cubre además. */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;

  /** Notas libres para el audit log (ej: "venta semanal viernes"). */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
