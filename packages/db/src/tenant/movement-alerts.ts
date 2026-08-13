/**
 * Tabla `movement_alerts` (DB de tenant).
 *
 * Alertas de fraude INTERNO sobre movimientos del ledger (minteo/correcciones/
 * transferencias/cash-out). A diferencia de `fraud_account_links` (cuentas
 * duplicadas), acá cada fila es UNA alerta de una regla que se disparó sobre
 * un actor/sujeto en un período.
 *
 * Diseño:
 *   - `rule`: código de la regla (mint_near_cap, employee_cap_abuse,
 *     actor_burst, actor_concentration, repeat_counterparty, fast_cashout).
 *   - `actor_user_id`: quién hizo el movimiento (null para alertas
 *     tenant-level como el tope de minteo global).
 *   - `subject_user_id`: contraparte/objetivo si aplica (ej. el cómplice).
 *   - `amount`: monto relevante (ej. lo minteado, lo transferido).
 *   - `severity`: low/medium/high según qué tan por encima del umbral está.
 *   - `details` jsonb: los números para el panel (used, cap, pct, count…).
 *   - `period`: clave de período/ventana (ej. '2026-08' o '2026-08-12-24h').
 *   - `dedup_key`: `rule|actor|subject|period` (UNIQUE) para UPSERT idempotente.
 *   - `status`: suspected/confirmed/dismissed. El scan preserva `dismissed`.
 */

import {
  index,
  jsonb,
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

export const movementAlertSeverityEnum = pgEnum('movement_alert_severity', [
  'low',
  'medium',
  'high',
]);

export const movementAlertStatusEnum = pgEnum('movement_alert_status', [
  'suspected',
  'confirmed',
  'dismissed',
]);

export const movementAlerts = pgTable(
  'movement_alerts',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),

    rule: text('rule').notNull(),

    actorUserId: uuid('actor_user_id').references(() => users.id, {
      onDelete: 'cascade',
    }),

    subjectUserId: uuid('subject_user_id').references(() => users.id, {
      onDelete: 'cascade',
    }),

    amount: numeric('amount', { precision: 20, scale: 2 }),

    severity: movementAlertSeverityEnum('severity').notNull().default('medium'),

    details: jsonb('details').notNull().default({}),

    period: text('period').notNull(),

    /** `rule|actorId|subjectId|period` — UNIQUE para UPSERT idempotente. */
    dedupKey: text('dedup_key').notNull(),

    status: movementAlertStatusEnum('status').notNull().default('suspected'),

    reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id),

    reviewedAt: timestamp('reviewed_at', { withTimezone: true, mode: 'date' }),

    detectedAt: timestamp('detected_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),

    lastUpdatedAt: timestamp('last_updated_at', {
      withTimezone: true,
      mode: 'date',
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('movement_alerts_dedup_uniq').on(table.dedupKey),
    index('movement_alerts_status_severity_idx').on(table.status, table.severity),
    index('movement_alerts_actor_idx').on(table.actorUserId),
  ],
);

export type MovementAlert = typeof movementAlerts.$inferSelect;
export type NewMovementAlert = typeof movementAlerts.$inferInsert;
