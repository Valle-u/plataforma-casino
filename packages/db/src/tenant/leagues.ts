/**
 * Tabla `leagues` (DB de tenant).
 *
 * Leaderboards multi-período (doc 15 §C). Cada liga tiene:
 *   - `period`: tag semántico (daily/weekly/monthly/season/custom). El
 *     timing concreto lo da `startsAt`/`endsAt`.
 *   - `metric`: cómo se rankea (bet_volume, rounds_count, gross_won,
 *     player_netwin, score_custom).
 *   - `prizes`: por posición. Soporta rangos. Ej:
 *       { "1": { kind: "chips", amount: 100000 },
 *         "2-5": { kind: "chips", amount: 25000 },
 *         "6-10": { kind: "bonus", definitionId: "uuid", amount: 5000 } }
 *   - `funded_by_user_id`: quien paga los premios (resuelto al crear).
 *
 * Status:
 *   - `scheduled`: creada, todavía no comenzó (now < startsAt).
 *   - `active`: corriendo (startsAt <= now < endsAt).
 *   - `closed`: ya se cerró + settled. Premios entregados.
 *
 * El cron de cierre transiciona `active → closed` cuando `endsAt < NOW()`.
 */

import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '../utils/uuid';
import { users } from './users';

export const leaguePeriodEnum = pgEnum('league_period', [
  'daily',
  'weekly',
  'monthly',
  'season',
  'custom',
]);

export const leagueMetricEnum = pgEnum('league_metric', [
  'bet_volume',
  'rounds_count',
  'gross_won',
  'player_netwin',
  'score_custom',
]);

export const leagueStatusEnum = pgEnum('league_status', [
  'scheduled',
  'active',
  'closed',
]);

export const leagues = pgTable(
  'leagues',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),

    code: text('code').notNull(),
    name: text('name').notNull(),

    period: leaguePeriodEnum('period').notNull(),
    metric: leagueMetricEnum('metric').notNull(),

    /** Para `score_custom`: fórmula. Para otros: vacío o config menor. */
    metricConfig: jsonb('metric_config').notNull().default({}),

    /**
     * Premios por posición. Ver doc 15 §C4. Estructura libre, parseada por
     * `LeaguesService` al settle. Soporta keys "1", "2", "2-5", "6-10".
     */
    prizes: jsonb('prizes').notNull().default({}),

    startsAt: timestamp('starts_at', { withTimezone: true, mode: 'date' }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true, mode: 'date' }).notNull(),

    status: leagueStatusEnum('status').notNull().default('scheduled'),

    visibility: jsonb('visibility').notNull().default({}),

    /** Quien paga los premios. Resuelto al crear. */
    fundedByUserId: uuid('funded_by_user_id')
      .notNull()
      .references(() => users.id),

    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('leagues_code_uniq').on(table.code),
    index('leagues_status_idx').on(table.status),
    index('leagues_status_ends_at_idx').on(table.status, table.endsAt),
  ],
);

export type League = typeof leagues.$inferSelect;
export type NewLeague = typeof leagues.$inferInsert;
