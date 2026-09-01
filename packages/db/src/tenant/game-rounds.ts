/**
 * Tabla `game_rounds` (DB de tenant).
 *
 * Cada apuesta = un round. Histórico append-only (mismo patrón
 * `commission_payouts`). Trazabilidad completa: bet_amount, win_amount,
 * net, status, payload del provider, links a wallet_transactions.
 *
 * Spec: `docs/14-roadmap.md §8`.
 *
 * Lifecycle de un round (controlado por `GameRoundsService` — Sprint 35):
 *   1. **placed**: bet committed, wallet debit ejecutado. Si win:
 *      eventualmente settle_amount > 0.
 *   2. **settled**: provider devolvió resultado, wallet credit (si win)
 *      ejecutado. Estado terminal del happy path.
 *   3. **rolled_back**: el round se canceló (error del provider, doble
 *      submit, etc.). El bet se devolvió al wallet (refund). Terminal.
 *
 * Idempotencia:
 *   - `round_external_id` (id del provider) + `session_id` UNIQUE.
 *     Misma combinación = mismo round (provider retry seguro).
 *   - `bet_wallet_tx_id` y `win_wallet_tx_id` linkean al wallet_tx que
 *     ejecutó cada lado. NULL si pending.
 *
 * Particionado mensual: pendiente para v1 cuando volumen lo justifique.
 */

import {
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { generateUuidV7 } from '../utils/uuid';
import { gameSessions } from './game-sessions';
import { games } from './games';
import { users } from './users';
import { walletTransactions } from './wallet-transactions';

export const gameRoundStatusEnum = pgEnum('game_round_status', [
  'placed',
  'settled',
  'rolled_back',
]);

export const gameRounds = pgTable(
  'game_rounds',
  {
    id: uuid('id').primaryKey().$defaultFn(generateUuidV7),

    sessionId: uuid('session_id')
      .notNull()
      .references(() => gameSessions.id),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id),

    /**
     * ID del round que devuelve el provider en placeBet. Para mock:
     * UUID interno generado por GameRoundsService. Para provider real:
     * lo que devuelva el adapter.
     */
    roundExternalId: text('round_external_id').notNull(),

    /** Monto apostado (chips). */
    betAmount: numeric('bet_amount', { precision: 20, scale: 2 }).notNull(),

    /**
     * Monto ganado. 0 si perdió, >0 si ganó (incluye stake si aplica
     * según el juego — la convención es "lo que el wallet recibe back").
     */
    winAmount: numeric('win_amount', { precision: 20, scale: 2 })
      .notNull()
      .default('0'),

    /** win_amount - bet_amount. Computado al settle. */
    netAmount: numeric('net_amount', { precision: 20, scale: 2 })
      .notNull()
      .default('0'),

    status: gameRoundStatusEnum('status').notNull().default('placed'),

    /** Wallet tx del bet (debit). */
    betWalletTxId: uuid('bet_wallet_tx_id').references(
      () => walletTransactions.id,
    ),

    /** Wallet tx del win (credit). NULL si lost o pending settle. */
    winWalletTxId: uuid('win_wallet_tx_id').references(
      () => walletTransactions.id,
    ),

    /** Wallet tx del rollback (credit refund). NULL si no fue rollbacked. */
    rollbackWalletTxId: uuid('rollback_wallet_tx_id').references(
      () => walletTransactions.id,
    ),

    /**
     * Payload del provider (resultado del spin/round). Mock guarda
     * el RNG seed + reels/cartas/multiplier para auditoría.
     */
    payload: jsonb('payload').notNull().default({}),

    /**
     * Tipo de RONDA, normalizado en el callback.
     *
     * Sin esto una compra de tiradas gratis se ve identica a un giro normal
     * en los reportes: un `bet` grande, y despues premios sin apuesta que los
     * explique.
     *
     * No alcanza con guardar la accion cruda del proveedor: la compra y el
     * giro comun llegan las dos como `action=spin`. Lo que las distingue es
     * que la compra trae ademas `byBonus` / `freeSpinAdd` en el estado del
     * juego. El dato util para auditar no es la accion suelta sino el tipo de
     * ronda, que sale de mirar la ronda entera.
     *
     *   `bonus_buy`  el jugador COMPRO la feature.
     *   `free_spins` corrio tiradas gratis sin comprarlas (se dispararon).
     *   `spin`       ronda comun.
     *   NULL         ronda pre-migracion 0106, o proveedor que no informa
     *                (hoy Palace y Forever).
     *
     * Se va ACTUALIZANDO con las acciones de la ronda: abre como `spin` o
     * `bonus_buy` y sube a `free_spins` si aparece una tirada gratis.
     * `bonus_buy` nunca se pisa -- comprar es mas especifico que que se
     * disparen solas.
     *
     * TEXT libre y no enum: todavia no conocemos el vocabulario completo de
     * los proveedores. Ante un valor inesperado preferimos registrarlo antes
     * que rechazar el callback -- la plata ya se movio.
     */
    action: text('action'),

    placedAt: timestamp('placed_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),

    settledAt: timestamp('settled_at', { withTimezone: true, mode: 'date' }),

    /**
     * NULL = la cerró el proveedor mandando `round_finished: true` (lo normal).
     * No NULL = la cerramos nosotros, y acá queda con qué criterio.
     *
     * Existe porque Gregmorn deja rondas abiertas para siempre y su API no
     * tiene endpoint para consultarlas: hay que cerrarlas por nuestra cuenta,
     * y sin esta marca el cierre automático sería indistinguible del real.
     * Ver la migración 0109 y `RoundsReconciliationService`.
     */
    autoSettledReason: text('auto_settled_reason'),

    rolledBackAt: timestamp('rolled_back_at', {
      withTimezone: true,
      mode: 'date',
    }),
  },
  (table) => [
    // Idempotency: mismo external_id en misma session = mismo round.
    uniqueIndex('game_rounds_session_external_unique').on(
      table.sessionId,
      table.roundExternalId,
    ),
    // Hot path 1: rounds del user (history).
    index('game_rounds_user_placed').on(table.userId, table.placedAt),
    // Hot path 2: rounds de una session.
    index('game_rounds_session_placed').on(table.sessionId, table.placedAt),
    // Hot path 3: stats por game.
    index('game_rounds_game_placed').on(table.gameId, table.placedAt),
    // Hot path 4: reporting de netwin/GGR/comisiones — filtran `status='settled'`
    // + rango de `settled_at` (WalletStatsService.netwinFor, network-commissions).
    // Sin índice sobre status/settled_at hacían seq scan + sort de la tabla más
    // grande.
    index('game_rounds_status_settled').on(table.status, table.settledAt),
    // Filtrar por tipo de jugada en reportes ("mostrame las compras de tiradas
    // gratis"). Parcial: casi todas las filas viejas son NULL.
    // Join inverso desde wallet_transactions (auditoria de Estadisticas de
    // pago). La FK no crea indice del lado que referencia.
    index('game_rounds_bet_wallet_tx_idx')
      .on(table.betWalletTxId)
      .where(sql`${table.betWalletTxId} IS NOT NULL`),
    index('game_rounds_win_wallet_tx_idx')
      .on(table.winWalletTxId)
      .where(sql`${table.winWalletTxId} IS NOT NULL`),
    index('game_rounds_rollback_wallet_tx_idx')
      .on(table.rollbackWalletTxId)
      .where(sql`${table.rollbackWalletTxId} IS NOT NULL`),
    index('game_rounds_action_idx')
      .on(table.action)
      .where(sql`${table.action} IS NOT NULL`),
  ],
);

export type GameRound = typeof gameRounds.$inferSelect;
export type NewGameRound = typeof gameRounds.$inferInsert;
