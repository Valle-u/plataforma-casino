/**
 * Tabla `fraud_signals` (DB de tenant).
 *
 * Señales crudas detectadas por los scanners antifraude. Snapshot
 * recreado en cada `runScan` (DELETE all + INSERT) — la fuente
 * autoritativa del estado actual.
 *
 * Diseño:
 *   - 1 row por (user, signal_type, target). E.g. user X comparte IP
 *     1.2.3.4 con 2 otros users → 1 signal con payload listando los
 *     otros users.
 *   - `weight` numeric: aporte al score del par (0-100).
 *   - `payload jsonb`: detalle específico del signal type. Variable.
 */

import {
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '../utils/uuid';
import { users } from './users';

export const fraudSignals = pgTable(
  'fraud_signals',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** Tipo de señal: 'shared_ip', 'similar_email', etc. */
    signalType: text('signal_type').notNull(),

    /** Detalle libre del signal — referencia al otro user, IP, etc. */
    payload: jsonb('payload').notNull().default({}),

    weight: numeric('weight', { precision: 5, scale: 2 }).notNull(),

    detectedAt: timestamp('detected_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('fraud_signals_user_idx').on(table.userId),
    index('fraud_signals_type_idx').on(table.signalType),
  ],
);

export type FraudSignal = typeof fraudSignals.$inferSelect;
export type NewFraudSignal = typeof fraudSignals.$inferInsert;
