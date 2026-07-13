/**
 * Tipos de los callbacks que Palace nos envía.
 * Espejo del ejemplo PHP del proveedor (callback-example.php).
 */

/** Body del request que Palace nos manda. */
export interface PalaceCallbackRequest {
  command: PalaceCommand;
  data: PalaceCallbackData;
  /** CSV de checks a validar antes de procesar. Ej: "21,22,41,31". */
  check: string;
  /** Timestamp del request (epoch UTC). */
  timestamp?: string;
  /** Timestamp interno de la transacción (epoch UTC). */
  request_timestamp?: string;
}

export type PalaceCommand =
  | 'authenticate'
  | 'balance'
  | 'bet'
  | 'win'
  | 'cancel'
  | 'status';

export interface PalaceCallbackData {
  /** ID del round (agrupa bet+win). */
  round_id?: string;
  /** ID del user del proveedor (int64). */
  user_code?: number;
  /** ID único de la transacción (idempotencia). */
  trans_guid?: string;
  /** ID de la transacción a cancelar (para cancel command). */
  cancel_trans_guid?: string;
  /** Account del jugador (4-15 chars = el name que le pasamos a user/create). */
  account?: string;
  /** Monto de la operación (decimal, siempre positivo). */
  amount?: string | number;
  /** game_code del catálogo del proveedor (ej. 'vs10emotiwins'). */
  game_code?: string;
  /** Tipo de juego (slot, live, baccarat, etc.). */
  game_type?: string;
  /** ID del provider en Palace (1-26). */
  provider_id?: number;
  /** Tipo de transacción: 1=Bet, 2=Win, 16=BetCancel, 32=BonusCall. */
  type?: number;
  /** Timestamp de la transacción (epoch UTC). */
  time_stamp?: string | number;
}

/** Response que le devolvemos a Palace. */
export interface PalaceCallbackResponse {
  result: number;
  status: 'OK' | 'ERROR';
  data?: Record<string, unknown>;
}

/** Códigos de result que Palace espera. */
export const PALACE_RESULT = {
  OK: 0,
  CALLBACK_TOKEN_INVALID: 100,
  CHECK_USER_NOT_FOUND: 21,
  CHECK_USER_NOT_ACTIVE: 22,
  CHECK_INSUFFICIENT_BALANCE: 31,
  CHECK_ALREADY_PROCESSED: 41,
  CHECK_TX_NOT_FOUND: 42,
  CHECK_CANCEL_TX_NOT_FOUND: 43,
  INTERNAL_ERROR: 99,
} as const;