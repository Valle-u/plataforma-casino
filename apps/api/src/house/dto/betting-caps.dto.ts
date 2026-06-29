import { IsNumber, Max, Min } from 'class-validator';

/**
 * Topes de apuesta mensuales (B-build-4b). 0 = sin tope.
 */
export class SetBettingCapsDto {
  /** Tope mensual de turnover por jugador. 0 = sin tope. */
  @IsNumber()
  @Min(0)
  @Max(1_000_000_000_000)
  playerMonthly!: number;

  /** Tope mensual de turnover global del tenant. 0 = sin tope. */
  @IsNumber()
  @Min(0)
  @Max(1_000_000_000_000)
  globalMonthly!: number;
}
