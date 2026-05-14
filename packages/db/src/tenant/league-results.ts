/**
 * Tabla `league_results` (DB de tenant).
 *
 * Resultado FINAL de cada user que cobró premio en una league cerrada.
 * Append-only — no se modifica una vez insertado (auditoría de premios
 * históricos).
 *
 * Diseño:
 *   - 1 row por (league, user) que ganó premio. Users que participaron
 *     pero no entraron en posiciones premiadas NO tienen row acá.
 *   - `prize` snapshot del descriptor entregado.
 *   - `walletTxId` y `bonusId` linkean al payout efectivo (los dos son
 *     null si el premio era kind=try_again / free_spins TODO).
 *   - `idempotencyKey` UNIQUE intra-league (`settle:<userId>`) — re-run
 *     del settle no duplica.
 */

import {
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  integer,
} from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '../utils/uuid';
import { leagues } from './leagues';
import { userBonuses } from './user-bonuses';
import { users } from './users';
import { walletTransactions } from './wallet-transactions';

export const leagueResults = pgTable(
  'league_results',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),

    leagueId: uuid('league_id')
      .notNull()
      .references(() => leagues.id),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),

    finalPosition: integer('final_position').notNull(),

    finalScore: numeric('final_score', { precision: 20, scale: 4 }).notNull(),

    /** Descriptor del premio entregado. */
    prize: jsonb('prize').notNull(),

    walletTxId: uuid('wallet_tx_id').references(() => walletTransactions.id),

    bonusId: uuid('bonus_id').references(() => userBonuses.id),

    idempotencyKey: text('idempotency_key').notNull(),

    settledAt: timestamp('settled_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('league_results_league_idem_uniq').on(
      table.leagueId,
      table.idempotencyKey,
    ),
    index('league_results_user_idx').on(table.userId),
    index('league_results_league_position_idx').on(table.leagueId, table.finalPosition),
  ],
);

export type LeagueResult = typeof leagueResults.$inferSelect;
export type NewLeagueResult = typeof leagueResults.$inferInsert;
