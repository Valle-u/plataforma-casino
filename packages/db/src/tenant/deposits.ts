/**
 * Tabla `deposits` (DB de tenant).
 *
 * Flujo de carga autoservicio del jugador. Ver `docs/05 §6`.
 *
 * Estados:
 *   - pending: recién creado, esperando review.
 *   - under_review: cajero/empleado lo tomó pero aún no decidió.
 *   - approved: cajero aprobó → wallet tx generada → `wallet_tx_id` set.
 *   - rejected: cajero rechazó con motivo.
 *   - expired: el TTL se cumplió sin acción (job nocturno; v1+).
 *   - cancelled: el jugador lo canceló antes del review.
 *
 * `amount_chips` es el monto FINAL en fichas que se acredita al user.
 * `amount_fiat` es lo que el user reporta haber transferido en moneda real.
 * El ratio chips/fiat depende del método y configuración del tenant (no
 * lo modelamos acá: el cajero al aprobar decide el monto en chips, basado
 * en el comprobante).
 *
 * `wallet_tx_id` queda NULL hasta que se aprueba. Cuando se aprueba, se
 * crea una wallet_transaction `type='deposit'` y se linkea acá.
 *
 * Constraint: máx 2 deposits 'pending' (o 'under_review') por user. Eso
 * lo enforce el service en la capa de aplicación (no tiene constraint SQL
 * porque requiere COUNT condicional).
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
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { generateUuidV7 } from '../utils/uuid';
import { paymentMethods } from './payment-methods';
import { users } from './users';
import { walletTransactions } from './wallet-transactions';

export const depositStatusEnum = pgEnum('deposit_status', [
  'pending',
  'under_review',
  'approved',
  'rejected',
  'expired',
  'cancelled',
]);

export const deposits = pgTable(
  'deposits',
  {
    id: uuid('id').primaryKey().$defaultFn(generateUuidV7),

    /** User que solicita el depósito (jugador). */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** Método de pago elegido. */
    methodId: uuid('method_id')
      .notNull()
      .references(() => paymentMethods.id),

    /** Monto que el user reporta haber transferido en moneda fiat/cripto. */
    amountFiat: numeric('amount_fiat', { precision: 20, scale: 2 }).notNull(),

    /** Moneda fiat: 'ARS', 'USDT', etc. */
    currencyFiat: text('currency_fiat').notNull(),

    /**
     * Monto en chips que se acredita. Lo decide el cajero al aprobar
     * (o lo propone el user y el cajero valida).
     */
    amountChips: numeric('amount_chips', { precision: 20, scale: 2 }).notNull(),

    status: depositStatusEnum('status').notNull().default('pending'),

    /** URL/identificador del comprobante en S3 (o equivalente). NULL si todavía no se subió. */
    receiptUrl: text('receipt_url'),

    /** Hash cripto, n° operación banco, etc. para conciliación. */
    externalRef: text('external_ref'),

    /** Cajero/empleado al que se le asigna (NULL = pool general). */
    assignedTo: uuid('assigned_to').references(() => users.id),

    /** Quien aprobó/rechazó. */
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true, mode: 'date' }),

    rejectionReason: text('rejection_reason'),

    /** Tx wallet generada al aprobar. NULL hasta entonces. */
    walletTxId: uuid('wallet_tx_id').references(() => walletTransactions.id),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check('deposits_amount_fiat_positive', sql`${table.amountFiat} > 0`),
    check('deposits_amount_chips_positive', sql`${table.amountChips} > 0`),
    index('deposits_user_status').on(table.userId, table.status),
    index('deposits_assigned_status').on(table.assignedTo, table.status),
    index('deposits_status_created').on(table.status, table.createdAt),
  ],
);

export type Deposit = typeof deposits.$inferSelect;
export type NewDeposit = typeof deposits.$inferInsert;
