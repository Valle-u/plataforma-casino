/**
 * Tabla `gregmorn_transactions` (DB de tenant).
 *
 * Espejo de `palace_transactions` / `forever_transactions`, para el modelo
 * seamless de Gregmorn Hub: cada callback que MUEVE plata (`writeBet` y
 * `rollback`) inserta una fila. El `getBalance` es de solo lectura y no se
 * registra acá.
 *
 * ⚠️ **La clave de idempotencia NO es el `transaction_id`.**
 *
 * Gregmorn manda el `rollback` con el **mismo `transactionId` que el bet que
 * revierte** — está explícito en su spec: *"The rollback transaction matches the
 * bet transaction (same transaction ID)"*. Si se usara el `transaction_id` crudo
 * como clave única, el rollback se vería como duplicado del bet y se
 * descartaría en silencio: **el jugador nunca recuperaría la apuesta de una
 * ronda anulada.**
 *
 * Por eso la clave única es `idempotency_key = '<cmd>:<transactionId>'`, que
 * separa las dos patas. El proveedor confirmó este criterio el 2026-08-28
 * ("Yes, you can do it this way"). Ver docs/gregmorn/README.md §Trampas #1.
 *
 * APPEND-ONLY: un rollback es su propia fila, no muta la del bet.
 */

import {
  boolean,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '../utils/uuid';
import { users } from './users';

/** `cmd` del callback. Solo los dos que mueven plata. */
export const gregmornCmdEnum = pgEnum('gregmorn_cmd', ['writeBet', 'rollback']);

export const gregmornTransactions = pgTable(
  'gregmorn_transactions',
  {
    id: uuid('id').primaryKey().$defaultFn(generateUuidV7),

    /**
     * `<cmd>:<transactionId>`. UNIQUE — es la idempotencia real.
     * NO usar `transaction_id` solo: el rollback lo repite (ver docblock).
     */
    idempotencyKey: text('idempotency_key').notNull(),

    /** `cmd` del callback: writeBet | rollback. */
    cmd: gregmornCmdEnum('cmd').notNull(),

    /**
     * `transactionId` CRUDO del proveedor. NO es único: el rollback comparte el
     * del bet. Sirve para reconciliar las dos patas de una ronda anulada.
     */
    transactionId: text('transaction_id').notNull(),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** `login` del callback = nuestro `users.username` (lo mandamos en openGame). */
    login: text('login').notNull(),

    /** Sesión de juego de ellos (`sessionid`). */
    sessionId: text('session_id'),

    /** Monto apostado. Llega número o string; se normaliza antes de guardar. */
    bet: numeric('bet', { precision: 20, scale: 2 }).notNull().default('0'),

    /** Monto ganado. Mismo criterio que `bet`. */
    win: numeric('win', { precision: 20, scale: 2 }).notNull().default('0'),

    /** `gameId` del proveedor (`integration:provider:game`). */
    gameId: text('game_id'),

    /** Id de la ronda, si el estudio lo manda. */
    roundId: text('round_id'),

    /** `round_finished` del callback. */
    roundFinished: boolean('round_finished').notNull().default(false),

    /** `info`: JSON serializado como string con el detalle del estudio. */
    info: text('info'),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Idempotencia real: cmd + transactionId.
    uniqueIndex('gregmorn_tx_idempotency_key_unique').on(table.idempotencyKey),
    // Reconciliación: las dos patas (bet y su rollback) comparten transaction_id.
    index('gregmorn_tx_transaction_id').on(table.transactionId),
    index('gregmorn_tx_user_created').on(table.userId, table.createdAt),
  ],
);

export type GregmornTransaction = typeof gregmornTransactions.$inferSelect;
export type NewGregmornTransaction = typeof gregmornTransactions.$inferInsert;
