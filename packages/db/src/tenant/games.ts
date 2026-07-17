/**
 * Tabla `games` (DB de tenant).
 *
 * Catálogo de juegos disponibles para el tenant. Cada juego apunta a un
 * provider (mock o real cuando llegue) y guarda un `config` jsonb con
 * parámetros específicos del provider/game (RTP, min/max bet, líneas, etc.).
 *
 * Spec: `docs/14-roadmap.md §8` (Fase 5 — Mock Game Provider) +
 *       `docs/own-games/00-overview.md` (futuro juegos propios).
 *
 * Convenciones:
 *   - `code` único intra-tenant (lower_snake): el url/iframe lo usa.
 *   - `provider_code`: identificador del adapter. Hoy solo 'mock'.
 *   - `category`: 'slots' | 'live' | 'crash' | 'table' | 'mini' — drive el lobby.
 *   - `is_active`: soft-delete. Archivado NO aparece en lobby pero las
 *     game_sessions/rounds históricas siguen referenciables.
 *   - `thumbnail_url`: opcional. Si null, lobby muestra placeholder.
 *   - `config` jsonb es libre — el provider lo interpreta. Para slots
 *     mock típicamente: `{ rtp: 0.96, minBet: 1, maxBet: 1000 }`.
 *   - `featured` + `sortOrder`: drive el "destacados" del lobby home.
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '../utils/uuid';

export const gameCategoryEnum = pgEnum('game_category', [
  'slots',
  'live',
  'crash',
  'table',
  'mini',
]);

export const games = pgTable(
  'games',
  {
    id: uuid('id').primaryKey().$defaultFn(generateUuidV7),

    /** Slug único intra-tenant, lowercase + snake. */
    code: text('code').notNull(),

    /** Nombre visible al jugador. */
    name: text('name').notNull(),

    /** Identificador del provider adapter. MVP: 'mock'. */
    providerCode: text('provider_code').notNull().default('mock'),

    /** Categoría drive el lobby. */
    category: gameCategoryEnum('category').notNull(),

    /**
     * URL externa de thumbnail (160x120 sugerido). NULL = lobby usa
     * placeholder generado del DS. Subir a CDN externo en MVP — sin
     * upload propio todavía (mismo patrón que branding.logo_url).
     */
    thumbnailUrl: text('thumbnail_url'),

    /**
     * Descripción corta visible en el card del lobby (≤120 chars
     * recomendado).
     */
    shortDescription: text('short_description'),

    /**
     * Config específico del provider/game. Para slots mock:
     *   { rtp: 0.96, minBet: '1', maxBet: '1000', volatility: 'medium' }
     * Para crash: { houseEdge: 0.01, maxMultiplier: 100 }.
     */
    config: jsonb('config').notNull().default({}),

    /** Marcado por el admin para aparecer en "Destacados" del home. */
    featured: boolean('featured').notNull().default(false),

    /** Orden manual dentro de cada categoría. Lower = primero. */
    sortOrder: integer('sort_order').notNull().default(0),

    /**
     * Palace Casino — ID del provider en Palace (1-26).
     * NULL si el juego no es de Palace. Usado en `game/game-url` para
     * construir el launch.
     */
    palaceProviderId: integer('palace_provider_id'),

    /**
     * Palace Casino — `game_code`/`game_symbol` del catálogo del proveedor
     * (ej. 'vs10emotiwins'). NULL si el juego no es de Palace. Usado en
     * `game/game-url` como `game_symbol`.
     */
    palaceGameSymbol: text('palace_game_symbol'),

    isActive: boolean('is_active').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('games_code_unique').on(table.code),
    // Hot path lobby: list active + by category.
    index('games_active_category_sort').on(
      table.isActive,
      table.category,
      table.sortOrder,
    ),
    // Hot path "destacados".
    index('games_featured_sort').on(table.featured, table.sortOrder),
  ],
);

export type Game = typeof games.$inferSelect;
export type NewGame = typeof games.$inferInsert;
