/**
 * Tabla `commission_payouts` (DB de tenant).
 *
 * Registro APPEND-ONLY de cada commission pagada (o pendiente). Fuente
 * de verdad para forensics + reporting de revenue share por upstream.
 *
 * Reglas:
 *   - **Nunca UPDATE/DELETE** — append-only. Si una commission tiene que
 *     "revertirse" (e.g. deposit rejected después de approve), se INSERTA
 *     una row de tipo opuesto (refund) y se linkean.
 *   - Snapshot del rule + role al momento de pago (rule_id + role + pct)
 *     porque las reglas pueden cambiar después y los pagos viejos deben
 *     conservar lo que efectivamente se cobró.
 *   - `wallet_tx_id` linkea al wallet_transaction efectivo (credit al
 *     beneficiario). Si NULL: status='pending' (no se ejecutó todavía,
 *     caso edge: rule sin funder válido o error transient).
 *
 * Particionado mensual: pendiente — premature optimization para MVP. Cuando
 * los volúmenes lo justifiquen, `PARTITION BY RANGE (created_at)`.
 */

import {
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '../utils/uuid';
import { commissionRules } from './commission-rules';
import { users } from './users';
import { walletTransactions } from './wallet-transactions';

export const commissionPayoutStatusEnum = pgEnum('commission_payout_status', [
  /**
   * Sprint 50: nuevo default. Significa "commission devengada al aprobarse
   * el deposit, todavía no liquidada al beneficiary". El admin la pasa
   * a 'paid' al ejecutar `commissions.settle` — eso mintea las fichas
   * y las acredita al beneficiary.
   */
  'accrued',
  /** Legacy (Sprint 24-25): commission ejecutada wallet-to-wallet en el momento. */
  'pending',
  'paid',
  'failed',
  'refunded',
]);

export const commissionPayouts = pgTable(
  'commission_payouts',
  {
    id: uuid('id').primaryKey().$defaultFn(generateUuidV7),

    /**
     * Evento que disparó la commission. Ej: 'deposit_approved'.
     * Mismo set que `commission_rules.event_type`.
     */
    sourceEventType: text('source_event_type').notNull(),

    /**
     * ID del registro del evento (deposit.id, withdrawal.id, etc.).
     * SIN FK polimórfica — el `source_event_type` indica a qué tabla
     * apunta. Para queries de "todas las commissions de deposit X",
     * filtrar por `source_event_type='deposit_approved' AND source_event_id=X`.
     */
    sourceEventId: uuid('source_event_id').notNull(),

    /** Beneficiario (cajero/distrib/socio del cliente del evento). */
    beneficiaryUserId: uuid('beneficiary_user_id')
      .notNull()
      .references(() => users.id),

    /**
     * Snapshot del rol del beneficiario al momento del pago. Mismo valor
     * que `commission_rules.role`. Si el user cambia de rol después, el
     * payout viejo conserva el rol original.
     */
    beneficiaryRoleAtTime: text('beneficiary_role_at_time').notNull(),

    /**
     * Rule que aplicó. NULL solo si la rule se borró duramente después
     * (no debería pasar — soft-delete es el patrón).
     */
    ruleId: uuid('rule_id').references(() => commissionRules.id),

    /**
     * Monto base del evento. Ej: si el deposit fue por $1000, source_amount=1000.
     * Snapshot — no cambia si después se edita el deposit.
     */
    sourceAmount: numeric('source_amount', { precision: 20, scale: 2 }).notNull(),

    /** Porcentaje aplicado (snapshot de rule.pct al momento del pago). */
    pct: numeric('pct', { precision: 5, scale: 2 }).notNull(),

    /** Resultado: source_amount * (pct / 100). Calculado al insertar. */
    payoutAmount: numeric('payout_amount', { precision: 20, scale: 2 }).notNull(),

    /**
     * wallet_transaction credit al beneficiario. NULL si pending/failed
     * (no se ejecutó todavía).
     */
    walletTxId: uuid('wallet_tx_id').references(() => walletTransactions.id),

    status: commissionPayoutStatusEnum('status').notNull().default('pending'),

    /** Mensaje de error si status='failed'. */
    error: text('error'),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),

    /** Cuándo se ejecutó el credit (status pasó a 'paid'). NULL si no aún. */
    paidAt: timestamp('paid_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    // Hot path 1: reporting "commissions del beneficiario X en período Y".
    index('commission_payouts_beneficiary_created').on(
      table.beneficiaryUserId,
      table.createdAt,
    ),
    // Hot path 2: "todas las commissions de este deposit/withdrawal".
    index('commission_payouts_source').on(
      table.sourceEventType,
      table.sourceEventId,
    ),
    // Hot path 3: dispatcher pickea pending FIFO (futuro post-MVP).
    index('commission_payouts_status_created').on(
      table.status,
      table.createdAt,
    ),
  ],
);

export type CommissionPayout = typeof commissionPayouts.$inferSelect;
export type NewCommissionPayout = typeof commissionPayouts.$inferInsert;
