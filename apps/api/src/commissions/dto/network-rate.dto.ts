import { IsNumber, Max, Min } from 'class-validator';

/** Comisiones por red (C1): fija el % que un hijo directo gana de su NetWin. */
export class SetNetworkRateDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  rate!: number;
}
