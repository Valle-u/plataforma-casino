import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

const AMOUNT_REGEX = /^(?!0+(?:\.0+)?$)\d+(?:\.\d{1,2})?$/;

const FIAT_CURRENCIES = ['ARS', 'USDT', 'USD', 'BRL'] as const;
type FiatCurrency = (typeof FIAT_CURRENCIES)[number];

export class CreateDepositDto {
  @IsUUID()
  methodId!: string;

  @IsString()
  @Matches(AMOUNT_REGEX, {
    message: 'amountFiat debe ser un número positivo con hasta 2 decimales.',
  })
  amountFiat!: string;

  @IsIn(FIAT_CURRENCIES)
  currencyFiat!: FiatCurrency;

  @IsString()
  @Matches(AMOUNT_REGEX, {
    message: 'amountChips debe ser un número positivo con hasta 2 decimales.',
  })
  amountChips!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  receiptUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  externalRef?: string;
}
