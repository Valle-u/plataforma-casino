/**
 * Tipos de la Main API de Forever (Operator API). Ver docs/forever/01-api-spec.md.
 *
 * Todas las llamadas son POST a UN solo endpoint (`api_url`), con el `method` en
 * el body. El envelope es PLANO: `{ status, msg, ...camposDeData }` (status 0 = OK).
 * Firma Ed25519 en headers X-Forever-Sig-* (ver forever-signer.ts).
 */

/** Códigos de respuesta (Appendix 4.1 del spec). */
export const FOREVER_STATUS = {
  SUCCESS: 0,
  INTERNAL_ERROR: 1,
  INVALID_ACTION: 2,
  INVALID_AGENT: 3,
  BLOCK_AGENT: 4,
  INVALID_USER: 5,
  BLOCK_USER: 6,
  DUPLICATE_USER: 7,
  INSUFFICIENT_MONEY: 8,
  INVALID_VENDOR: 12,
  INVALID_PARAMETER: 13,
  NETWORK_ERROR: 14,
  MAINTENANCE: 15,
  INVALID_WAGER: 18,
  INVALID_TIME: 20,
  DUPLICATE_REQUESTKEY: 21,
  TIMEOUT_ERROR: 22,
} as const;

/** Tipo de juego (Appendix 4.2). */
export const FOREVER_GAME_TYPE = {
  SLOT: 1,
  LIVE_CASINO: 2,
} as const;

/** Base de toda respuesta de la Main API. */
export interface ForeverResponseBase {
  status: number;
  msg?: string | null;
}

/** Vendor (proveedor de juegos dentro de Forever). Model 5.3. */
export interface ForeverVendor {
  vendorCode: string;
  vendorName: string;
  gameType: number;
}

/** Juego de un vendor. Model 5.4. */
export interface ForeverVendorGame {
  gameCode: string;
  gameName: string;
  gameType: number;
  imageUrl: string | null;
}

/** Respuesta de GetGameUrl (launch). */
export interface ForeverGameUrlResult {
  /** URL del juego para el iframe/redirect. */
  launchUrl: string;
}

/** Canal de launch. */
export type ForeverChannel = 'desktop' | 'mobile';
