/**
 * Tipos de la API de Gregmorn Hub. Ver docs/gregmorn/01-api-spec.md y el
 * `openapi-v1.0.json` de esa misma carpeta (fuente de verdad).
 *
 * Diferencias con Forever:
 *   - DOS hosts: `office` (auth + catálogo) y `client` (abrir juego).
 *   - Auth mixta: Bearer para el catálogo, HMAC `X-Signature` para `openGame`.
 *     El login es form-urlencoded, NO JSON.
 *   - Envelope de error propio: `{ status: 'fail', error, code, message }`.
 *
 * Modelo de wallet: SEAMLESS. El transfer wallet (`/apiIndividualWallet/`) NO se
 * integra — rompería E1/E2 de docs/LEYES.md.
 */

/** `provider_code` del adapter. Espeja `games.provider_code`. */
export const GREGMORN_CODE = 'gregmorn';

/** Moneda por default de las sesiones si el tenant no la configuró. */
export const GREGMORN_DEFAULT_CURRENCY = 'ARS';

/** Idioma por default del launch si el tenant no lo configuró (ISO corto). */
export const GREGMORN_DEFAULT_LANGUAGE = 'es';

// ──────────────────────────────────────────────────────────────────────
// Nosotros → ellos
// ──────────────────────────────────────────────────────────────────────

/** Saldo del usuario de API por moneda (`/auth/login` → `user.currencies`). */
export interface GregmornUserCurrency {
  currency: string;
  /** Viene como string decimal (ej. "12450.00"). */
  count: string;
}

/** Usuario de API que devuelve el login. */
export interface GregmornUser {
  id: string;
  login: string;
  role: string;
  currencies: GregmornUserCurrency[];
}

/**
 * Respuesta de `POST /auth/login`.
 *
 * OJO: devuelven `refreshToken` pero NO documentan endpoint de refresh. Cuando
 * el `accessToken` expira hay que volver a llamar a `/auth/login`.
 */
export interface GregmornLoginResponse {
  accessToken: string;
  refreshToken: string;
  user: GregmornUser;
}

/**
 * Item del catálogo (`GET /users/{user_id}/getUserGames/{currencyISO}`).
 *
 * El `id` viene con forma `integration:provider:game` (ej.
 * `integration_a:provider_a:game_001`) y es lo que se manda como `gameId` al
 * abrir el juego.
 */
export interface GregmornGameCatalogItem {
  id: string;
  isEnabled: boolean;
  title: string;
  imageUrl: string;
  /** Estudio real detrás del juego (ej. "PG Soft", "Evolution"). */
  provider: string;
}

/** Modo demo: `'1'` no dispara callbacks de wallet; `'0'` es juego real. */
export type GregmornDemoFlag = '0' | '1';

/** Body de `POST /games/openGame`. Los 7 primeros son obligatorios. */
export interface GregmornOpenGameRequest {
  currency: string;
  demo: GregmornDemoFlag;
  exitUrl: string;
  gameId: string;
  /** ISO corto: en, es, pt… */
  language: string;
  /** Login del JUGADOR en nuestra plataforma. */
  player_login: string;
  /** Id del usuario de API (el nuestro, no el del jugador). */
  user_id: string;
  /** IP del jugador. Algunos estudios la exigen. */
  ip?: string;
  /** Pisa la callback URL del panel de ellos. Siempre la mandamos explícita. */
  callbackUrl?: string;
  freespinTotalBet?: number;
  freespinCount?: number;
}

/** Respuesta OK de `openGame`. */
export interface GregmornOpenGameResponse {
  status: 'success';
  error: string;
  content: {
    game: { url: string };
    gameRes: { sessionId: string };
  };
}

/** Contrato de error de ellos (documentado con HTTP 409). */
export interface GregmornErrorResponse {
  status: 'fail';
  error: string;
  code: number;
  message: string;
}

/** Lo que nos interesa del launch, ya digerido. */
export interface GregmornGameUrlResult {
  launchUrl: string;
  providerSessionId: string;
}

// ──────────────────────────────────────────────────────────────────────
// Ellos → nosotros (callbacks seamless) — se consumen en la Fase 5
// ──────────────────────────────────────────────────────────────────────

/** Los tres comandos que llegan a nuestra callback URL. */
export const GREGMORN_CMD = {
  GET_BALANCE: 'getBalance',
  WRITE_BET: 'writeBet',
  ROLLBACK: 'rollback',
} as const;

export type GregmornCmd = (typeof GREGMORN_CMD)[keyof typeof GREGMORN_CMD];

/**
 * Monto de un callback.
 *
 * **Puede venir número O string**: ellos avisan que los vendors SL-Games y
 * X-Games mandan string. Asumir número es un bug de plata silencioso.
 */
export type GregmornAmount = number | string;

/**
 * Body de cualquier callback entrante. Se rutea por `cmd`; los campos se validan
 * en el service según el comando (no todos aplican a los tres).
 */
export interface GregmornCallbackBody {
  cmd?: string;
  login?: string;
  sessionid?: string;
  bet?: GregmornAmount;
  win?: GregmornAmount;
  /**
   * Id de transacción de ellos.
   *
   * ⚠️ **El `rollback` llega con el MISMO `transactionId` que el bet que
   * revierte.** Usarlo crudo como `idempotency_key` hace que el rollback se vea
   * como duplicado y se ignore en silencio: el jugador nunca recupera la
   * apuesta. Hay que namespacear con `cmd + transactionId`. Ver la trampa #1 de
   * docs/gregmorn/README.md.
   */
  transactionId?: string;
  gameId?: string;
  roundId?: string;
  round_finished?: boolean;
  /** JSON serializado como string, con el detalle del estudio. */
  info?: string;
}

/**
 * Respuesta que devolvemos a los tres callbacks.
 *
 * - Aceptar: HTTP 2xx + `status: 'success'`.
 * - Rechazar: HTTP 400+ + `status: 'fail'` con el motivo en `error`.
 *
 * El `balance` va **después** de aplicar la operación.
 */
export interface GregmornCallbackResponse {
  balance: number;
  currency: string;
  error: string;
  login: string;
  status: 'success' | 'fail';
}
