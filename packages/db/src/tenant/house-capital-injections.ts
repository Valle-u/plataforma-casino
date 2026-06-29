/**
 * Tabla `house_capital_injections` (DB de tenant).
 *
 * Aportes de capital del dueño a la Casa / tesorería (Blindaje del núcleo
 * económico, Parte B, B-build-3). Ver docs/16-tesoreria.md §5.5.
 *
 * Es la ÚNICA forma de crear fichas nuevas en el sistema: el dueño mete plata
 * real (una transferencia ENTRANTE registrada en `bank_transactions`) y se
 * mintea ese monto a la wallet de la Casa. Respaldado por construcción —
 * 1 bank_tx ↔ 1 aporte (UNIQUE), y el aporte sólo procede si el bank_tx está
 * sin matchear.
 *
 * Append-only. El minteo + el match del bank_tx + esta fila son atómicos (un
 * solo `db.transaction` en el HouseService).
 */

import {
  check,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { generateUuidV7 } from '../utils/uuid';
import { bankTransactions } from './bank-transactions';
import { users } from './users';
import { walletTransactions } from './wallet-transactions';

export const houseCapitalInjections = pgTable(
  'house_capital_injections',
  {
    id: uuid('id').primaryKey().$defaultFn(generateUuidV7),

    /** Monto aportado, en fichas (= moneda base, 1 ficha = 1 peso). */
    amount: numeric('amount', { precision: 20, scale: 2 }).notNull(),

    /** Bank_tx ENTRANTE que respalda el aporte (la plata real del dueño). */
    bankTransactionId: uuid('bank_transaction_id')
      .notNull()
      .references(() => bankTransactions.id),

    /** wallet_tx del minteo a la Casa. NULL sólo si algo falló a mitad. */
    mintTxId: uuid('mint_tx_id').references(() => walletTransactions.id),

    /** Admin que hizo el aporte. */
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),

    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check('house_capital_amount_positive', sql`${table.amount} > 0`),
    // 1 transferencia bancaria respalda como mucho 1 aporte de capital.
    uniqueIndex('house_capital_bank_tx_unique').on(table.bankTransactionId),
  ],
);

export type HouseCapitalInjection = typeof houseCapitalInjections.$inferSelect;
export type NewHouseCapitalInjection =
  typeof houseCapitalInjections.$inferInsert;
