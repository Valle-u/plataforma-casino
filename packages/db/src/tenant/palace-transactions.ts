/**
 * Tabla `palace_transactions` (DB de tenant).
 *
 * Espejo de `bet_casino` del ejemplo PHP del proveedor. Cada callback
 * de Palace (bet, win, cancel) inserta una fila acá. Sirve para:
 *   - Idempotencia: `trans_guid` UNIQUE → check 41 (ya procesado).
 *   - Status: `status` command busca por `trans_guid` → OK o CANCELED.
 *   - Cancel: busca `cancel_trans_guid` → marca CANCELED + reversa wallet.
 *
 * NO es append-only estricta: el command `cancel` hace UPDATE del `status`
 * de la fila original (OK → CANCELED). Esto matchea el comportamiento del
 * ejemplo PHP del proveedor.
 */

import {
  bigserial,
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

export const palaceTxSortEnum = pgEnum('palace_tx_sort', [
  'BET',
  'WIN',
  'CANCEL',
]);

export const palaceTxStatusEnum = pgEnum('palace_tx_status', [
  'OK',
  'CANCELED',
]);

export const palaceTransactions = pgTable(
  'palace_transactions',
  {
    id: uuid('id').primaryKey().$defaultFn(generateUuidV7),

    /** ID único del proveedor (idempotencia). UNIQUE. */
    transGuid: text('trans_guid').notNull(),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** Account del callback (4-15 chars). */
    account: text('account').notNull(),

    /** game_code del callback (ej. 'vs10emotiwins'). */
    gameCode: text('game_code'),

    /** game_type del callback (slot, live, etc.). */
    gameType: text('game_type'),

    /** round_id del callback (agrupador de bet+win). */
    roundId: text('round_id'),

    /** Tipo de operación: BET | WIN | CANCEL. */
    sort: palaceTxSortEnum('sort').notNull(),

    /** Monto de la transacción (siempre positivo). */
    amount: numeric('amount', { precision: 20, scale: 2 }).notNull(),

    /** Estado: OK | CANCELED. Cancel hace UPDATE a CANCELED. */
    status: palaceTxStatusEnum('status').notNull().default('OK'),

    /** provider_id del callback (1-26). */
    providerId: integer('provider_id'),

    /** type del callback: 1=Bet, 2=Win, 16=BetCancel (ver Main API doc). */
    type: integer('type'),

    /**
     * ID del user_code del proveedor (int64). Para cross-reference con
     * `users.palace_user_code` y debugging.
     */
    userCode: bigserial('user_code_ref', { mode: 'number' }),

    /** Timestamp del request del callback (UTC). */
    requestTimestamp: timestamp('request_timestamp', {
      withTimezone: true,
      mode: 'date',
    }),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Idempotencia: trans_guid único. Check 41 del callback.
    uniqueIndex('palace_tx_trans_guid_unique').on(table.transGuid),
    // Hot path: cancel busca por cancel_trans_guid (que es un transGuid original).
    index('palace_tx_user_created').on(table.userId, table.createdAt),
    // Hot path: status command busca por trans_guid + account.
    index('palace_tx_account_trans_guid').on(table.account, table.transGuid),
  ],
);

export type PalaceTransaction = typeof palaceTransactions.$inferSelect;
export type NewPalaceTransaction = typeof palaceTransactions.$inferInsert;