import {
  IsIn,
  IsObject,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';

const AMOUNT_REGEX = /^(?!0+(?:\.0+)?$)\d+(?:\.\d{1,2})?$/;
const FIAT_CURRENCIES = ['ARS', 'USDT', 'USD', 'BRL'] as const;
type FiatCurrency = (typeof FIAT_CURRENCIES)[number];

export class CreateWithdrawalDto {
  @IsUUID()
  methodId!: string;

  @IsString()
  @Matches(AMOUNT_REGEX, {
    message: 'amountChips debe ser un número positivo con hasta 2 decimales.',
  })
  amountChips!: string;

  @IsString()
  @Matches(AMOUNT_REGEX, {
    message: 'amountFiat debe ser un número positivo con hasta 2 decimales.',
  })
  amountFiat!: string;

  @IsIn(FIAT_CURRENCIES)
  currencyFiat!: FiatCurrency;

  /** Datos de destino: CBU, alias, wallet address, etc. */
  @IsObject()
  targetAccount!: Record<string, unknown>;
}
