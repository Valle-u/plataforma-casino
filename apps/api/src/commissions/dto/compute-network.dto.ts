import { IsOptional, IsString } from 'class-validator';

/** Motor NetWin (C2): dispara el cómputo de comisiones por red de un período. */
export class ComputeNetworkPeriodDto {
  /** 'YYYY-MM' o fecha ISO. Ausente = mes anterior completo (default operativo). */
  @IsOptional()
  @IsString()
  period?: string;
}
