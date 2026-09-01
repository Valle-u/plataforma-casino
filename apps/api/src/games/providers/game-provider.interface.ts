/**
 * `IGameProvider` — contrato que cumple cada provider de juegos.
 *
 * Los proveedores reales (Palace, Forever) son SEAMLESS: el jugador apuesta
 * dentro del juego del proveedor y el settle se reconcilia por callback. El
 * adapter solo resuelve el `launchGame` (URL del iframe + provider session id);
 * NO hay loop de apuesta interno del lado nuestro.
 *
 * Filosofía:
 *   - El provider NO toca DB de tenant directamente salvo para el mapping que
 *     el launch necesita (ej. Palace user_code).
 *   - GameSessionsService orquesta: llama al provider, persiste la sesión.
 */

import type { Game } from '@casino/db';

/**
 * Params del launch — todos vienen del orchestrador, el provider los usa
 * solo para construir la URL del iframe + provider session id.
 */
export interface LaunchParams {
  game: Game;
  userId: string;
  /** Currency de la sesión (MVP: 'CHIPS'). */
  currency: string;
  /**
   * IP real del jugador, para los proveedores que la piden.
   *
   * Sale de `x-forwarded-for` (primer valor), o sea la IP del cliente
   * detrás de Cloudflare y Traefik. `null` si no se pudo resolver.
   *
   * Sin esto, Gregmorn completaba `UserIp` con una IP de datacenter — la
   * MISMA para todos los jugadores. Un estudio que haga control geográfico
   * o antifraude sobre ese campo ve a todo el casino saliendo del mismo
   * lugar.
   */
  playerIp?: string | null;
}

export interface LaunchResult {
  /** ID que el provider asocia a la sesión. Puede ser opaco para nosotros. */
  providerSessionId: string;
  /** URL al que apunta el iframe del jugador. */
  launchUrl: string;
}

export interface IGameProvider {
  /** Identificador del adapter — espeja `games.provider_code`. */
  readonly code: string;

  /**
   * Params del launch. Palace lo necesita para leer/escribir el mapping
   * de user_code en la DB del tenant.
   */
  launchGame(
    params: LaunchParams,
    /** DB del tenant. Opcional — solo providers que persisten. */
    db?: unknown,
  ): Promise<LaunchResult>;
}
