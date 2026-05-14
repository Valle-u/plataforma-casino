/**
 * Tabla `league_standings` (DB de tenant).
 *
 * Snapshot vivo del ranking de una league. Se recalcula periódicamente
 * (cron) o on-demand (admin force-recompute / endpoint user). PK
 * compuesta `(league_id, user_id)` — un user solo aparece una vez por
 * league.
 *
 * Diseño:
 *   - `score numeric(20, 4)` para soportar score_custom con decimales.
 *     bet_volume / gross_won serán enteros pero usamos decimales para
 *     unificar.
 *   - `position` materializada en cada update para servir el endpoint
 *     "top N + posición del user actual" sin tener que recalcular.
 *   - `last_updated_at` para detectar standings obsoletos.
 */

import {
  index,
  numeric,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
  integer,
} from 'drizzle-orm/pg-core';
import { leagues } from './leagues';
import { users } from './users';

export const leagueStandings = pgTable(
  'league_standings',
  {
    leagueId: uuid('league_id')
      .notNull()
      .references(() => leagues.id),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),

    score: numeric('score', { precision: 20, scale: 4 }).notNull(),

    position: integer('position').notNull(),

    lastUpdatedAt: timestamp('last_updated_at', {
      withTimezone: true,
      mode: 'date',
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.leagueId, table.userId] }),
    // Index para ranked queries: ORDER BY position dentro de una league.
    index('league_standings_league_position_idx').on(table.leagueId, table.position),
  ],
);

export type LeagueStanding = typeof leagueStandings.$inferSelect;
export type NewLeagueStanding = typeof leagueStandings.$inferInsert;
