/**
 * DTOs del lifecycle session/round (Sprint 35).
 */

import { IsString, Matches } from 'class-validator';

const AMOUNT_REGEX = /^\d{1,18}(?:\.\d{1,2})?$/;

export class PlaceBetDto {
  @IsString()
  @Matches(AMOUNT_REGEX, {
    message: 'Bet amount inválido (positivo, ≤2 decimales).',
  })
  amount!: string;
}
