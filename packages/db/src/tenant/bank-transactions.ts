/**
 * Tabla `bank_transactions` (DB de tenant) — Sprint 50.
 *
 * Separación de funciones: el empleado de confianza del tenant lee el
 * extracto bancario real y carga acá cada transferencia entrante. El
 * cajero NO tiene acceso al banco — solo ve esta tabla y matchea cada
 * `deposit` pending con una bank_transaction sin matchear.
 *
 * Reglas:
 *   - Append-only en condiciones normales. DELETE solo admin (audit).
 *   - UPDATE permitido para campos de matching (status, matched_*, notes).
 *   - 1 bank_transaction matchea con 0 o 1 deposit (relación 1:0..1).
 *   - El monto de la bank_tx DEBE coincidir con `deposits.amountFiat`
 *     para match automático. Override (admin/cajero con notes) permite
 *     match con monto distinto (caso: comisión bancaria, monto redondeado).
 *
 * Por qué no FK en una dirección sola:
 *   - `bank_transactions.matched_deposit_id` está acá para ver "esta tx
 *     respaldó qué deposit".
 *   - `deposits.bank_transaction_id` se agrega en una migration aparte
 *     para query rápido "este deposit fue respaldado por qué transferencia".
 *   - Ambos NULL hasta el match. Atomicidad la garantiza el service.
 */

import {
  check,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { generateUuidV7 } from '../utils/uuid';
import { deposits } from './deposits';
import { users } from './users';

/**
 * Status de la bank_transaction:
 *   - unmatched: subida pero sin asociar a deposit.
 *   - matched:   asociada a un deposit aprobado.
 *   - disputed:  el admin marcó que algo no cierra (audit). No bloquea.
 */
export const bankTransactionStatusEnum = pgEnum('bank_transaction_status', [
  'unmatched',
  'matched',
  'disputed',
]);

export const bankTransactions = pgTable(
  'bank_transactions',
  {
    id: uuid('id').primaryKey().$defaultFn(generateUuidV7),

    /**
     * Identificador del banco/cuenta donde llegó. Texto libre — puede
     * ser CBU, alias, código interno del tenant. Permite filtrar por
     * cuenta cuando el tenant tiene varios bancos.
     */
    bankAccount: text('bank_account').notNull(),

    /** Monto efectivamente acreditado en el banco. */
    amount: numeric('amount', { precision: 20, scale: 2 }).notNull(),

    /** Moneda — default ARS pero el tenant puede operar en USDT, USD, etc. */
    currency: text('currency').notNull().default('ARS'),

    /** Nombre del remitente según el extracto. */
    senderName: text('sender_name'),

    /** CBU/alias del remitente si el banco lo expone. */
    senderCbu: text('sender_cbu'),

    /** Mensaje/concepto que el remitente puso. */
    reference: text('reference'),

    /**
     * Identificador de la transferencia según el banco — número de
     * operación, hash cripto, ID interno del extracto. Útil para
     * conciliar 2 veces la misma tx sin duplicar.
     */
    bankReference: text('bank_reference'),

    /** Cuándo llegó la plata al banco (timestamp del extracto). */
    receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' })
      .notNull(),

    status: bankTransactionStatusEnum('status').notNull().default('unmatched'),

    /** Empleado que cargó la tx al sistema. */
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),

    /** Deposit asociado tras match. NULL hasta entonces. */
    matchedDepositId: uuid('matched_deposit_id').references(() => deposits.id),

    /** Quién matcheó (cajero/admin) y cuándo. NULL hasta el match. */
    matchedBy: uuid('matched_by').references(() => users.id),
    matchedAt: timestamp('matched_at', { withTimezone: true, mode: 'date' }),

    /**
     * Si el match fue override (monto distinto al deposit), el cajero
     * DEBE escribir motivo acá. Audit severity:high en ese caso.
     */
    overrideReason: text('override_reason'),

    /** Notas libres del empleado/cajero. */
    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check('bank_tx_amount_positive', sql`${table.amount} > 0`),
    // Hot path: empleado busca "qué subí hoy".
    index('bank_tx_uploaded_by_uploaded').on(table.uploadedBy, table.uploadedAt),
    // Hot path: cajero busca unmatched por monto exacto.
    index('bank_tx_status_amount').on(table.status, table.amount),
    // Hot path: lookup por deposit matcheado.
    index('bank_tx_matched_deposit').on(table.matchedDepositId),
    // Idempotencia opcional: misma bank_reference de la misma cuenta no
    // debería subirse 2 veces. NULL permitido para casos sin referencia.
    uniqueIndex('bank_tx_account_ref_unique')
      .on(table.bankAccount, table.bankReference)
      .where(sql`${table.bankReference} IS NOT NULL`),
  ],
);

export type BankTransaction = typeof bankTransactions.$inferSelect;
export type NewBankTransaction = typeof bankTransactions.$inferInsert;
