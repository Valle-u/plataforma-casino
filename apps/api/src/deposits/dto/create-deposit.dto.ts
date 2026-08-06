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
  @IsUUID('loose')
  methodId!: string;

  @IsString()
  @Matches(AMOUNT_REGEX, {
    message: 'amountFiat debe ser un número positivo con hasta 2 decimales.',
  })
  amountFiat!: string;

  @IsIn(FIAT_CURRENCIES)
  currencyFiat!: FiatCurrency;

  /**
   * Parte B: las fichas las CALCULA el server desde el ratio del método
   * (monto_fiat × chips_per_unit). Si el cliente lo manda, se IGNORA. Opcional
   * por compatibilidad; el form nuevo no lo envía.
   */
  @IsOptional()
  @IsString()
  @Matches(AMOUNT_REGEX, {
    message: 'amountChips debe ser un número positivo con hasta 2 decimales.',
  })
  amountChips?: string;

  /**
   * Sprint 51.6: REQUERIDO. URL del comprobante de pago. El cliente
   * sube el archivo via `POST /tenant/deposits/upload-proof` y el
   * endpoint devuelve la URL — esta DTO la espera ya provista.
   *
   * Storage backend (R2 / disk local) lo gestiona el StorageModule.
   * Cap de 2048 chars: los signed URLs de R2/S3 son largos (~600-800
   * con AWS Sig V4 + expiración) — 500 chars chocaba con R2 real.
   * No usamos `@IsUrl()` porque las URLs de signed-S3 a veces no
   * validan estrictamente.
   */
  @IsString()
  @IsNotEmpty({ message: 'El comprobante de pago es obligatorio.' })
  @MaxLength(2048)
  receiptUrl!: string;

  /**
   * Sprint 51.6: storage key opaco del archivo subido — necesario para
   * regenerar URLs (signed) y limpiar storage al rechazar el deposit.
   * El cliente lo recibe junto con `receiptUrl` desde el endpoint
   * `/upload-proof`. 500 chars alcanza — el key es un path corto sin
   * firma.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  receiptStorageKey!: string;

  /**
   * Sprint 55: SHA-256 del CONTENIDO del comprobante, calculado por el
   * server en `/upload-proof` y devuelto al cliente. Es el token de dedupe
   * real: el mismo archivo no puede respaldar dos depósitos. Se guarda en
   * `deposits.receipt_hash` (índice único parcial como backstop).
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  receiptHash?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  externalRef?: string;

  /**
   * Bono seleccionado por el jugador al crear el depósito. Opcional.
   * Si se provee, al aprobar se calcula y acredita el bonus en
   * bonus_balance (dual wallet).
   */
  @IsOptional()
  @IsUUID('loose')
  bonusDefinitionId?: string;
}

/** Body del POST /tenant/deposits/:id/approve. */
export class ApproveDepositDto {
  /**
   * Opcional: el admin puede otorgar un bono al aprobar.
   * Si se provee, se calcula el match y se acredita a bonus_balance.
   */
  @IsOptional()
  @IsUUID('loose')
  bonusDefinitionId?: string;
}
