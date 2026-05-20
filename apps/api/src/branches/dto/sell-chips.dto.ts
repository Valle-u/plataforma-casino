/**
 * DTO para `POST /tenant/users/:id/branch/sell-chips`.
 *
 * El admin "vende" fichas al socio independiente: mint en el wallet del
 * admin + transfer al wallet del socio (todo en una sola operación
 * `load_flow` con reason específica para auditoría).
 *
 * `amountChips` es el monto de fichas a transferir. El backend calcula
 * `amountFiat = amountChips * branchChipsPricePerUnit` (config del socio)
 * y lo registra en notes/audit para tracking del intercambio offline real.
 */

import { IsNumberString, IsOptional, IsString, MaxLength } from 'class-validator';

export class SellChipsDto {
  @IsNumberString()
  amountChips!: string;

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
