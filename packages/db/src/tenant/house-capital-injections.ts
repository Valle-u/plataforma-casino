/**
 * Tabla `house_capital_injections` (DB de tenant).
 *
 * Fondeos de la Casa / tesorería. Dos tipos (docs/16-tesoreria.md §5.5 y §12):
 *
 *   - `capital` (B-build-3, estricto): atado a una transferencia bancaria
 *     ENTRANTE (`bank_transaction_id` OBLIGATORIO); el monto viene del bank_tx;
 *     1 bank_tx ↔ 1 aporte (UNIQUE parcial). Máxima auditabilidad.
 *
 *   - `budget` (§12, presupuesto controlado): el admin crea un presupuesto de
 *     fichas directo (ej. "1M a inicio de mes"), SIN bank_tx. Cada fila lleva
 *     `reason` obligatorio + queda auditado en severity high. Modelo "banco
 *     central" — solo el admin emite; todo lo demás drena de la Casa.
 *
 * Append-only. El minteo + el registro son atómicos (un solo `db.transaction`
 * en el HouseService). En 'capital' además matchea el bank_tx en la misma tx.
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

    /** Tipo de fondeo. Ver docstring del archivo. */
    type: text('type').notNull().default('capital'),

    /** Monto aportado, en fichas (= moneda base, 1 ficha = 1 peso). */
    amount: numeric('amount', { precision: 20, scale: 2 }).notNull(),

    /**
     * Motivo del fondeo — obligatorio en ambos tipos. Auditado. Ej.:
     *   - capital: "aporte inicial", "reposición trimestral", etc.
     *   - budget:  "presupuesto julio 2026", "recarga float empleados", etc.
     */
    reason: text('reason').notNull(),

    /**
     * Bank_tx ENTRANTE que respalda el aporte. OBLIGATORIO cuando type='capital',
     * NULL cuando type='budget'. Enforcado por CHECK en la DB.
     */
    bankTransactionId: uuid('bank_transaction_id').references(
      () => bankTransactions.id,
    ),

    /** wallet_tx del minteo a la Casa. NULL sólo si algo falló a mitad. */
    mintTxId: uuid('mint_tx_id').references(() => walletTransactions.id),

    /** Admin (o delegado con `house.inject_capital`) que hizo el aporte. */
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
    check(
      'house_capital_type_valid',
      sql`${table.type} IN ('capital', 'budget')`,
    ),
    // Un aporte 'capital' obliga bank_tx; 'budget' lo puede omitir.
    check(
      'house_capital_capital_needs_bank_tx',
      sql`(${table.type} = 'budget') OR (${table.bankTransactionId} IS NOT NULL)`,
    ),
    // 1 bank_tx ↔ como mucho 1 aporte (UNIQUE parcial: solo cuando NOT NULL).
    uniqueIndex('house_capital_bank_tx_unique')
      .on(table.bankTransactionId)
      .where(sql`${table.bankTransactionId} IS NOT NULL`),
  ],
);

export type HouseCapitalInjection = typeof houseCapitalInjections.$inferSelect;
export type NewHouseCapitalInjection =
  typeof houseCapitalInjections.$inferInsert;
