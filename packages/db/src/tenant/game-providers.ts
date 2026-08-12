/**
 * Tabla `game_providers` (DB de tenant).
 *
 * Estado OPERACIONAL y de display de cada proveedor de juegos del tenant.
 * Una fila por proveedor (MVP: solo 'palace'). Prepara la plataforma para
 * multi-proveedor sin hardcodear Palace en la lógica de negocio.
 *
 * IMPORTANTE — separación de responsabilidades:
 *   - Las CREDENCIALES del proveedor (api_url, api_token, default_lang) NO
 *     viven acá: siguen en `tenant_settings` (keys `palace.*`, validadas por
 *     el registry) para no tocar el cliente/callback que mueve fichas. Esta
 *     tabla guarda el estado operativo: habilitado, mantenimiento, y el
 *     resultado del último sync + del último healthcheck/ping.
 *
 * Convenciones:
 *   - `code` único intra-tenant: identificador del adapter ('palace').
 *   - `is_enabled`: master switch del proveedor.
 *   - `maintenance_mode`: apaga todos los juegos del proveedor de una
 *     (enforcement del bloqueo de launch se cablea en Fase 2).
 *   - `last_sync_*` / `last_ping_*`: se actualizan tras cada sync manual /
 *     healthcheck. Sirven al panel "Estado del proveedor".
 *
 * Spec: sección "Game Providers" (docs/game-provider/*, docs/DEVLOG.md).
 */

import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '../utils/uuid';

export const gameProviders = pgTable(
  'game_providers',
  {
    id: uuid('id').primaryKey().$defaultFn(generateUuidV7),

    /** Identificador del adapter, único intra-tenant. MVP: 'palace'. */
    code: text('code').notNull(),

    /** Nombre visible en el panel (ej. 'Palace Casino'). */
    displayName: text('display_name').notNull(),

    /** Master switch del proveedor. Si false, sus juegos no operan. */
    isEnabled: boolean('is_enabled').notNull().default(true),

    /**
     * Modo mantenimiento: apaga TODOS los juegos del proveedor de golpe
     * (ej. el proveedor se cayó). El enforcement del bloqueo de apertura se
     * cablea en Fase 2; en Fase 1 solo se persiste el flag.
     */
    maintenanceMode: boolean('maintenance_mode').notNull().default(false),

    /** Timestamp del último sync manual (NULL = nunca sincronizado). */
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true, mode: 'date' }),

    /** ¿El último sync terminó OK? NULL = nunca corrió. */
    lastSyncOk: boolean('last_sync_ok'),

    /**
     * Resultado del último sync. En éxito:
     *   { fetched, created, updated, deactivated }
     * En error: { error: string }.
     */
    lastSyncResult: jsonb('last_sync_result'),

    /** Timestamp del último healthcheck/ping (NULL = nunca). */
    lastPingAt: timestamp('last_ping_at', { withTimezone: true, mode: 'date' }),

    /** ¿El último ping respondió OK? NULL = nunca. */
    lastPingOk: boolean('last_ping_ok'),

    /** Latencia del último ping en ms (NULL si falló o nunca corrió). */
    lastPingLatencyMs: integer('last_ping_latency_ms'),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex('game_providers_code_unique').on(table.code)],
);

export type GameProvider = typeof gameProviders.$inferSelect;
export type NewGameProvider = typeof gameProviders.$inferInsert;
