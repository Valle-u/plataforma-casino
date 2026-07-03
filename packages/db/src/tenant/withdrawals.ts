/**
 * Tabla `withdrawals` (DB de tenant).
 *
 * Flujo de retiro del jugador. Ver `docs/05 §7`.
 *
 * Estados:
 *   - pending: jugador solicitó, fichas en hold, esperando review.
 *   - approved: cajero/admin aprobó, en cola para pagar externamente.
 *   - processing: el pagador externo está procesando.
 *   - paid: transferencia externa hecha, balance debitado.
 *   - rejected: cajero rechazó con motivo, hold liberado.
 *   - failed: pagador externo reportó error, hold liberado.
 *
 * Lifecycle de holds:
 *   - Al crear: hold por `amount_chips` en wallet del user → `hold_id` set.
 *   - Si rejected/failed: release del hold sin afectar balance.
 *   - Si paid: release del hold + UPDATE wallet (debit balance) ya pasaron
 *     atómicamente dentro de la TX que marca paid.
 *
 * Diseño: usamos `wallet_holds` para reservar fichas mientras el retiro
 * está en revisión. Esto evita que el user pueda gastar las fichas que ya
 * pidió retirar (entre la solicitud y la aprobación).
 *
 * Constraint app-level (no SQL): máx 2 withdrawals 'pending'/'approved'/
 * 'processing' por user. Mismo que deposits.
 */

import {
  check,
  index,
  jsonb,
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
import { walletHolds } from './wallet-holds';
import { walletTransactions } from './wallet-transactions';
import { wallets } from './wallets';

export const withdrawalStatusEnum = pgEnum('withdrawal_status', [
  'pending',
  'approved',
  'processing',
  'paid',
  'rejected',
  'failed',
]);

export const withdrawals = pgTable(
  'withdrawals',
  {
    id: uuid('id').primaryKey().$defaultFn(generateUuidV7),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    methodId: uuid('method_id')
      .notNull()
      .references(() => paymentMethods.id),

    /** Monto en chips a debitar del wallet. */
    amountChips: numeric('amount_chips', { precision: 20, scale: 2 }).notNull(),

    /** Monto fiat equivalente que se va a transferir. */
    amountFiat: numeric('amount_fiat', { precision: 20, scale: 2 }).notNull(),

    /** 'ARS', 'USDT', etc. */
    currencyFiat: text('currency_fiat').notNull(),

    /**
     * Datos de destino del pago: CBU, alias, wallet address.
     * Shape específico por tipo de método.
     */
    targetAccount: jsonb('target_account').notNull(),

    status: withdrawalStatusEnum('status').notNull().default('pending'),

    /** Hold sobre la wallet del user mientras está pending. */
    holdId: uuid('hold_id').references(() => walletHolds.id),

    /** Wallet tx que debita las fichas (set al marcar paid). */
    walletTxId: uuid('wallet_tx_id').references(() => walletTransactions.id),

    /**
     * Sprint 51: outgoing bank_transaction que respalda este retiro.
     * REQUERIDA para markPaid (enforced en withdrawals.service). NULL en
     * retiros aún no pagados o legacy. FK no declarada porque la tabla
     * bank_transactions se evalúa después; integridad la chequea el
     * service en el match endpoint.
     */
    bankTransactionId: uuid('bank_transaction_id'),

    /**
     * F3 · Snapshot al momento de `create`: wallet que va a RECIBIR las
     * fichas del player cuando `markPaid` ejecute. Congela quién funde el
     * withdrawal aunque la jerarquía cambie entre create y paid. NULL en
     * rows previas al F3 (fallback a resolución en vivo en `markPaid`).
     */
    issuerWalletId: uuid('issuer_wallet_id').references(() => wallets.id, {
      onDelete: 'set null',
    }),

    /**
     * F3 · Snapshot al momento de `create`: user_id del operador indep
     * dueño de la rama; NULL si el issuer resuelto era la Casa del tenant.
     */
    issuerOperatorUserId: uuid('issuer_operator_user_id').references(
      () => users.id,
      { onDelete: 'set null' },
    ),

    assignedTo: uuid('assigned_to').references(() => users.id),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true, mode: 'date' }),
    rejectionReason: text('rejection_reason'),

    /** Referencia externa: hash cripto, n° operación banco. Set al pagar. */
    paidExternalRef: text('paid_external_ref'),
    paidAt: timestamp('paid_at', { withTimezone: true, mode: 'date' }),
    failureReason: text('failure_reason'),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check('withdrawals_amount_chips_positive', sql`${table.amountChips} > 0`),
    check('withdrawals_amount_fiat_positive', sql`${table.amountFiat} > 0`),
    index('withdrawals_user_status').on(table.userId, table.status),
    index('withdrawals_assigned_status').on(table.assignedTo, table.status),
    index('withdrawals_status_created').on(table.status, table.createdAt),
  ],
);

export type Withdrawal = typeof withdrawals.$inferSelect;
export type NewWithdrawal = typeof withdrawals.$inferInsert;
