import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

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

  /**
   * Sprint 51.6: REQUERIDO. URL del comprobante de pago. El cliente
   * sube el archivo via `POST /tenant/deposits/upload-proof` y el
   * endpoint devuelve la URL — esta DTO la espera ya provista.
   *
   * Storage backend (R2 / disk local) lo gestiona el StorageModule.
   * No-empty + max 500 chars. No usamos `@IsUrl()` porque las URLs
   * de signed-S3 a veces no validan estrictamente.
   */
  @IsString()
  @IsNotEmpty({ message: 'El comprobante de pago es obligatorio.' })
  @MaxLength(500)
  receiptUrl!: string;

  /**
   * Sprint 51.6: storage key opaco del archivo subido — necesario para
   * regenerar URLs (signed) y limpiar storage al rechazar el deposit.
   * El cliente lo recibe junto con `receiptUrl` desde el endpoint
   * `/upload-proof`.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  receiptStorageKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  externalRef?: string;
}
