/**
 * Tabla `fraud_account_links` (DB de tenant).
 *
 * Pares de cuentas vinculadas por antifraude. Convención: `user_a_id <
 * user_b_id` lexicográfico (UUID string compare) para que cada par tenga
 * UNA fila canónica.
 *
 * Diseño:
 *   - `score numeric(5,2)` 0-100 — agregado de weights de signals
 *     compartidos.
 *   - `signals jsonb` — array de `{type, weight}` con desglose.
 *   - `status` enum:
 *       - `suspected`: candidato vivo, pending review.
 *       - `confirmed`: admin confirmó duplicado real (cuenta a banear).
 *       - `dismissed`: admin descartó (false positive).
 *   - `reviewed_by` / `reviewed_at`: trail de quien revisó.
 *   - `last_updated_at`: cuándo se recalculó el score (cada scan).
 *
 * El scanner UPSERT — preserva `status='dismissed'` para no re-flagear
 * pares que el admin ya descartó.
 *
 * CHECK constraint `user_a_id < user_b_id` previene insertar el mismo
 * par invertido. UNIQUE en (user_a_id, user_b_id) garantiza uniqueness.
 */

import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '../utils/uuid';
import { users } from './users';

export const fraudLinkStatusEnum = pgEnum('fraud_link_status', [
  'suspected',
  'confirmed',
  'dismissed',
]);

export const fraudAccountLinks = pgTable(
  'fraud_account_links',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),

    userAId: uuid('user_a_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    userBId: uuid('user_b_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    score: numeric('score', { precision: 5, scale: 2 }).notNull(),

    signals: jsonb('signals').notNull().default([]),

    status: fraudLinkStatusEnum('status').notNull().default('suspected'),

    reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id),

    reviewedAt: timestamp('reviewed_at', { withTimezone: true, mode: 'date' }),

    lastUpdatedAt: timestamp('last_updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('fraud_account_links_pair_uniq').on(table.userAId, table.userBId),
    check('fraud_account_links_user_order', sql`${table.userAId} < ${table.userBId}`),
    index('fraud_account_links_status_score_idx').on(table.status, table.score),
  ],
);

export type FraudAccountLink = typeof fraudAccountLinks.$inferSelect;
export type NewFraudAccountLink = typeof fraudAccountLinks.$inferInsert;
