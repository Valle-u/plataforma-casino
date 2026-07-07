/**
 * DTOs del lifecycle session/round (Sprint 35).
 */

import { IsOptional, IsString, IsUUID, Matches } from 'class-validator';

const AMOUNT_REGEX = /^\d{1,18}(?:\.\d{1,2})?$/;

export class PlaceBetDto {
  @IsString()
  @Matches(AMOUNT_REGEX, {
    message: 'Bet amount inválido (positivo, ≤2 decimales).',
  })
  amount!: string;

  /**
   * Marca de idempotencia del cliente (una por giro). Opcional. Debe ser un
   * UUID: se usa como `roundExternalId` y se guarda en `reference_id` (columna
   * uuid). Si viene, un pedido repetido con la misma marca NO genera una
   * segunda apuesta (devuelve la ronda ya procesada). Cierra el doble clic /
   * reintento. El cliente lo genera con `crypto.randomUUID()`.
   */
  @IsOptional()
  @IsUUID()
  clientRoundId?: string;
}
