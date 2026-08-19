/**
 * Tabla `forever_transactions` (DB de tenant).
 *
 * Espejo de `palace_transactions` pero para el modelo de Forever (seamless):
 * cada callback `ChangeBalance` inserta una fila. Sirve para:
 *   - Idempotencia: `txn_code` UNIQUE (código 21 DUPLICATE_REQUESTKEY del spec).
 *   - Auditoría / reconciliación: liga Debit↔Credit/Cancel por `wager_id`.
 *
 * A diferencia de Palace, Forever manda el delta ya resuelto por `txn_type`
 * (0=Debit, 1=Credit, 2=Cancel) y NO tiene un command `status`, así que esta
 * tabla es APPEND-ONLY (un cancel es su propia fila; no se muta la original).
 */

import {
  index,
  integer,
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

/** Derivado de txn_type: 0→BET, 1→WIN, 2→CANCEL. */
export const foreverTxSortEnum = pgEnum('forever_tx_sort', [
  'BET',
  'WIN',
  'CANCEL',
]);

export const foreverTransactions = pgTable(
  'forever_transactions',
  {
    id: uuid('id').primaryKey().$defaultFn(generateUuidV7),

    /** Código de transacción del proveedor (idempotencia). UNIQUE. */
    txnCode: text('txn_code').notNull(),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** `userCode` del callback = nuestro site user code (el que mandamos a Forever). */
    userCode: text('user_code').notNull(),

    /** Vendor del juego (code de GetVendors). */
    vendorCode: text('vendor_code'),

    /** Tipo crudo del callback: 0=Debit, 1=Credit, 2=Cancel. */
    txnType: integer('txn_type').notNull(),

    /** Derivado legible: BET | WIN | CANCEL. */
    sort: foreverTxSortEnum('sort').notNull(),

    /** ID de la jugada — liga Debit ↔ Credit/Cancel. */
    wagerId: text('wager_id'),

    /** Diferenciador de pares múltiples (opcional). */
    pairCode: text('pair_code'),

    /** Monto de la transacción (siempre positivo; el signo lo da txn_type). */
    amount: numeric('amount', { precision: 20, scale: 2 }).notNull(),

    gameCode: text('game_code'),
    gameRoundId: text('game_round_id'),

    /** `isFreeRound` del callback. */
    isFreeRound: integer('is_free_round').notNull().default(0),

    /** `createdOn` del callback (UTC). */
    providerCreatedOn: timestamp('provider_created_on', {
      withTimezone: true,
      mode: 'date',
    }),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Idempotencia: txn_code único.
    uniqueIndex('forever_tx_txn_code_unique').on(table.txnCode),
    // Hot path: reconciliación por wager.
    index('forever_tx_wager').on(table.wagerId),
    index('forever_tx_user_created').on(table.userId, table.createdAt),
  ],
);

export type ForeverTransaction = typeof foreverTransactions.$inferSelect;
export type NewForeverTransaction = typeof foreverTransactions.$inferInsert;
