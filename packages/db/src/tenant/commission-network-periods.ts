/**
 * Tabla `commission_network_periods` (DB de tenant).
 *
 * Resultado del MOTOR de comisiones por red (modelo operativo, C2). Una fila
 * por (operador, período mensual): cuánto NetWin generó su sub-red, cuánta
 * comisión le corresponde (gross), el carryover encadenado, y lo que queda
 * liquidable (payable ≥ 0). Ver `docs/16-tesoreria.md §11`.
 *
 * Modelo (cascada/markup sobre NetWin):
 *   gross = R_self · subNetWin(self) − Σ R_hijo · subNetWin(hijo)
 *   newBalance = carryoverIn + gross
 *   payable    = max(0, newBalance)         (lo que se acumula para liquidar)
 *   carryoverOut = newBalance > 0 ? 0 : newBalance   (deuda arrastrada)
 *
 * Base NetWin = Σ(bet) − Σ(win) de game_rounds `status='settled'` (excluye
 * 'placed' en vuelo y 'rolled_back'), atribuido por `settled_at` en el
 * período half-open [period_start, period_end) UTC. Ramas independientes
 * EXCLUIDAS por completo.
 *
 * Idempotente: UNIQUE(operator_user_id, period_start). El compute recomputa
 * desde game_rounds (fuente de verdad) vía upsert; un período con status
 * 'paid' (ya liquidado en C3) NO se recomputa.
 *
 * Lifecycle:
 *   - 'accrued': computado, payable pendiente de liquidar.
 *   - 'paid': liquidado (C3) — wallet_tx_id linkea el pago (fichas) o la quema.
 *   - 'void': anulado.
 *
 * Append-mostly: el compute UPSERTea filas 'accrued'; C3 las pasa a 'paid'.
 */

import {
  check,
  index,
  numeric,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { generateUuidV7 } from '../utils/uuid';
import { users } from './users';
import { walletTransactions } from './wallet-transactions';

export const commissionNetworkPeriodStatusEnum = pgEnum(
  'commission_network_period_status',
  ['accrued', 'paid', 'void'],
);

export const commissionNetworkPeriods = pgTable(
  'commission_network_periods',
  {
    id: uuid('id').primaryKey().$defaultFn(generateUuidV7),

    /** El operador (socio/distribuidor/cajero) que gana esta comisión. */
    operatorUserId: uuid('operator_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** Inicio del período (1° del mes UTC). Half-open con period_end. */
    periodStart: timestamp('period_start', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),

    /** Fin del período (1° del mes siguiente UTC, exclusivo). */
    periodEnd: timestamp('period_end', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),

    /** NetWin agregada de la sub-red del operador en el período (excl. independientes). */
    subNetWin: numeric('sub_net_win', { precision: 20, scale: 2 })
      .notNull()
      .default('0'),

    /** Comisión bruta del período (puede ser negativa). */
    grossCommission: numeric('gross_commission', { precision: 20, scale: 2 })
      .notNull()
      .default('0'),

    /** Saldo arrastrado del período anterior (≤ 0 si la red venía perdiendo). */
    carryoverIn: numeric('carryover_in', { precision: 20, scale: 2 })
      .notNull()
      .default('0'),

    /** Saldo a arrastrar al próximo período (0 si payable>0, negativo si no). */
    carryoverOut: numeric('carryover_out', { precision: 20, scale: 2 })
      .notNull()
      .default('0'),

    /** Lo liquidable este período = max(0, carryoverIn + gross). Siempre ≥ 0. */
    payable: numeric('payable', { precision: 20, scale: 2 })
      .notNull()
      .default('0'),

    /** Snapshot del % del operador al momento del compute (auditoría). */
    rateSnapshot: numeric('rate_snapshot', { precision: 5, scale: 2 })
      .notNull()
      .default('0'),

    status: commissionNetworkPeriodStatusEnum('status')
      .notNull()
      .default('accrued'),

    /** Wallet tx de la liquidación (C3): pago en fichas o quema. NULL hasta pagar. */
    walletTxId: uuid('wallet_tx_id').references(() => walletTransactions.id),

    computedAt: timestamp('computed_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Idempotencia: una fila por operador por período.
    uniqueIndex('commission_network_periods_operator_period_unique').on(
      table.operatorUserId,
      table.periodStart,
    ),
    // Para listar "resultados del período X".
    index('commission_network_periods_period').on(table.periodStart),
    // payable nunca negativo (la deuda vive en carryover_out).
    check(
      'commission_network_periods_payable_nonneg',
      sql`${table.payable} >= 0`,
    ),
  ],
);

export type CommissionNetworkPeriod =
  typeof commissionNetworkPeriods.$inferSelect;
export type NewCommissionNetworkPeriod =
  typeof commissionNetworkPeriods.$inferInsert;
