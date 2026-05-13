import { IsString, Length, Matches } from 'class-validator';

/** Código TOTP de 6 dígitos. */
export class TwoFaCodeDto {
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, { message: 'code debe ser 6 dígitos numéricos.' })
  code!: string;
}
