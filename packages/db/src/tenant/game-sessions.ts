/**
 * Tabla `game_sessions` (DB de tenant).
 *
 * Una sesión por cada vez que el user "abre" un juego. Vive mientras el
 * iframe está abierto y el user puede betear. Se cierra cuando:
 *   - User cierra el iframe (frontend manda close beacon).
 *   - Inactividad > 30min (cron post-MVP).
 *   - Admin cierra (debugging / fraud).
 *
 * Spec: `docs/14-roadmap.md §8`.
 *
 * Reglas:
 *   - `provider_session_id`: ID que devuelve el provider en launchGame.
 *     Para mock: UUID interno. Para provider real (futuro): el ID externo.
 *   - `opened_balance`: snapshot del wallet del user al abrir. Para tracking
 *     "sesión cerró con +X o -Y".
 *   - `closing_balance`: snapshot al cerrar. NULL mientras activa.
 *   - Un user puede tener MÚLTIPLES sesiones activas simultáneas
 *     (juegos diferentes). Si re-launchea el mismo juego, el frontend
 *     debe reusar la sesión existente o crear una nueva — política a
 *     definir en GameSessionsService.
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
import { games } from './games';
import { users } from './users';

export const gameSessionStatusEnum = pgEnum('game_session_status', [
  'active',
  'closed',
  'expired',
]);

export const gameSessions = pgTable(
  'game_sessions',
  {
    id: uuid('id').primaryKey().$defaultFn(generateUuidV7),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id),

    /** ID que devuelve el provider en launchGame. */
    providerSessionId: text('provider_session_id').notNull(),

    /** Currency de la sesión. MVP: siempre 'CHIPS' (la única wallet). */
    currency: text('currency').notNull().default('CHIPS'),

    /** Snapshot del wallet del user al abrir la sesión. */
    openedBalance: numeric('opened_balance', { precision: 20, scale: 2 })
      .notNull()
      .default('0'),

    /** Snapshot al cerrar. NULL mientras activa. */
    closingBalance: numeric('closing_balance', { precision: 20, scale: 2 }),

    status: gameSessionStatusEnum('status').notNull().default('active'),

    /** Cuándo abrió. */
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),

    /** Cuándo cerró (status='closed' o 'expired'). */
    endedAt: timestamp('ended_at', { withTimezone: true, mode: 'date' }),

    /** IP + userAgent del request que abrió. Forensics. */
    openedFromIp: text('opened_from_ip'),
    openedFromUserAgent: text('opened_from_user_agent'),
  },
  (table) => [
    // Hot path: sesiones activas del user.
    index('game_sessions_user_status').on(table.userId, table.status),
    // Hot path: stats por juego.
    index('game_sessions_game_started').on(table.gameId, table.startedAt),
  ],
);

export type GameSession = typeof gameSessions.$inferSelect;
export type NewGameSession = typeof gameSessions.$inferInsert;
