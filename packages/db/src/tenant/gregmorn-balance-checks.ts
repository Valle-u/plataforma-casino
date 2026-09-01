/**
 * Tabla `gregmorn_balance_checks` (DB de tenant).
 *
 * Una fila por cada `getBalance` de Gregmorn, con lo que efectivamente
 * contestamos.
 *
 * ## Por qué existe
 *
 * El `getBalance` no mueve plata, así que no va a `gregmorn_transactions`. El
 * problema es que tampoco quedaba en ningún otro lado: los logs del contenedor
 * se podan con cada deploy. El 2026-09-01 los jugadores reportaron tres veces
 * que el juego abría con `CRÉDITO 0,00` teniendo saldo real, y las tres veces
 * fue imposible decir si la culpa era nuestra o del proveedor.
 *
 * No es teórico: `handleGetBalance` devuelve `UNKNOWN_PLAYER` cuando no logra
 * resolver al jugador por su `login`, y en ese caso el juego se queda sin saldo
 * — que es exactamente el síntoma reportado.
 *
 * ## Qué NO es
 *
 * Un registro de diagnóstico, no contable. Si en algún momento pesa, se poda
 * por `created_at` sin perder nada. La plata vive en `wallet_transactions`.
 */

import {
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '../utils/uuid';
import { users } from './users';

export const gregmornBalanceChecks = pgTable(
  'gregmorn_balance_checks',
  {
    id: uuid('id').primaryKey().$defaultFn(generateUuidV7),

    /**
     * El `login` que mandó el proveedor. Se guarda SIEMPRE, incluso cuando no
     * resuelve a un usuario nuestro: si no resolvió, es justamente el dato que
     * hace falta para entender por qué.
     */
    login: text('login').notNull(),

    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    /**
     * El `sessionid` de ellos, como texto. Cruza con
     * `game_sessions.provider_session_id` y con `gregmorn_transactions`.
     */
    sessionId: text('session_id'),
    gameId: text('game_id'),

    /** Lo que devolvimos. `null` cuando la respuesta fue un error. */
    balance: numeric('balance', { precision: 20, scale: 2 }),

    /** `ok` | `unknown_player`. */
    result: text('result').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('gregmorn_balance_checks_creado').on(table.createdAt),
    index('gregmorn_balance_checks_login_creado').on(
      table.login,
      table.createdAt,
    ),
  ],
);

export type GregmornBalanceCheck = typeof gregmornBalanceChecks.$inferSelect;
export type NewGregmornBalanceCheck = typeof gregmornBalanceChecks.$inferInsert;
