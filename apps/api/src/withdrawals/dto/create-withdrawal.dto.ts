import {
  IsIn,
  IsObject,
  IsOptional,
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

  /**
   * Parte B: la plata la CALCULA el server desde el ratio del método
   * (fichas ÷ chips_per_unit). Si el cliente lo manda, se IGNORA. Opcional por
   * compatibilidad; el form nuevo no lo envía.
   */
  @IsOptional()
  @IsString()
  @Matches(AMOUNT_REGEX, {
    message: 'amountFiat debe ser un número positivo con hasta 2 decimales.',
  })
  amountFiat?: string;

  @IsIn(FIAT_CURRENCIES)
  currencyFiat!: FiatCurrency;

  /** Datos de destino: CBU, alias, wallet address, etc. */
  @IsObject()
  targetAccount!: Record<string, unknown>;
}
