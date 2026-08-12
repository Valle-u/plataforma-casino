/**
 * Tabla `game_provider_logs` (DB de tenant).
 *
 * Registro de eventos/errores del proveedor de juegos, para el tab
 * "Logs / Diagnóstico" de la sección Game Providers. Observabilidad — NO
 * es la tabla de negocio (los movimientos de fichas viven en
 * palace_transactions / wallet_transactions).
 *
 * Eventos (`event_type`):
 *   - 'sync_error'     — falló traer el catálogo.
 *   - 'catalog_change' — resumen de un sync OK (cuántos nuevos/act./baja).
 *   - 'callback_error' — un callback de bet/win/cancel falló o dio timeout.
 *   - 'launch_error'   — falló abrir un juego.
 *   - 'ping'           — resultado de un healthcheck (ok/offline).
 *
 * `severity`: 'info' | 'warning' | 'error'.
 * `detail` jsonb: payload libre (error, counts, gameCode, latencia, etc.).
 *
 * Retención: 30 días (cron `palace-logs-retention`).
 */

import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '../utils/uuid';

export const gameProviderLogs = pgTable(
  'game_provider_logs',
  {
    id: uuid('id').primaryKey().$defaultFn(generateUuidV7),

    /** Proveedor al que refiere el evento (ej. 'palace'). */
    providerCode: text('provider_code').notNull(),

    /** Tipo de evento (ver cabecera). Texto libre con convención. */
    eventType: text('event_type').notNull(),

    /** 'info' | 'warning' | 'error'. */
    severity: text('severity').notNull().default('info'),

    /** Mensaje legible corto. */
    message: text('message').notNull(),

    /** Detalle estructurado libre (error, counts, gameCode, latencia…). */
    detail: jsonb('detail'),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Hot path del tab Logs: filtrar por proveedor + orden temporal.
    index('game_provider_logs_provider_created').on(
      table.providerCode,
      table.createdAt,
    ),
    // Retención: barrer por fecha.
    index('game_provider_logs_created').on(table.createdAt),
  ],
);

export type GameProviderLog = typeof gameProviderLogs.$inferSelect;
export type NewGameProviderLog = typeof gameProviderLogs.$inferInsert;
