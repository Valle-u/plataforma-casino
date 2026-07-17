/**
 * `IGameProvider` — contrato que cumple cada provider de juegos.
 *
 * Sprint 35: PalaceGameProvider es la implementación real. Futuros
 * providers se enchufan cumpliendo este contrato sin tocar el resto del
 * sistema.
 *
 * Filosofía:
 *   - El provider NO toca DB de tenant directamente. Solo computa.
 *   - GameSessionsService / GameRoundsService orquestan: llaman al
 *     provider, persisten en DB, ejecutan wallet transactions.
 *   - Provider determinístico para tests: acepta `rng` opcional que el
 *     caller puede stubear.
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
}

export interface LaunchResult {
  /** ID que el provider asocia a la sesión. Puede ser opaco para nosotros. */
  providerSessionId: string;
  /** URL al que apunta el iframe del jugador. */
  launchUrl: string;
}

export interface SettleParams {
  game: Game;
  userId: string;
  betAmount: string; // chips
  /** ID que el caller asignó al round (para idempotency). */
  roundExternalId: string;
  /** Override de RNG para tests determinísticos. Default Math.random. */
  rng?: () => number;
}

export interface SettleResult {
  /**
   * Monto ganado (chips). 0 si perdió. Convención: lo que el wallet del
   * jugador recibe back (no incluye el stake — el stake ya fue debitado).
   */
  winAmount: string;
  /**
   * Snapshot del cálculo para auditoría. Provider real guarda su payload
   * de respuesta.
   */
  payload: Record<string, unknown>;
}

export interface RollbackParams {
  roundExternalId: string;
  reason: string;
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

  /**
   * Resolución del round. Provider real es async (evento del provider
   * externo); Palace settlea vía callback.
   */
  settleRound(params: SettleParams): Promise<SettleResult>;

  /**
   * Cancela un round previamente settled. Provider real notifica al
   * provider del rollback. Idempotente.
   */
  rollback(params: RollbackParams): Promise<void>;
}
