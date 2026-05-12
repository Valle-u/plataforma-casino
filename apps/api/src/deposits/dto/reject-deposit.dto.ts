import { IsString, MaxLength, MinLength } from 'class-validator';

export class RejectDepositDto {
  /** Reason obligatorio para rechazo. */
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
