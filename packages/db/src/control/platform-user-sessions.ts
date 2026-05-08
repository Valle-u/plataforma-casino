/**
 * Tabla `platform_user_sessions` (DB de control).
 *
 * Una fila por cada sesión activa de un super-admin.
 *
 * Cada login crea una sesión con un refresh token (string random opaco).
 * El token NUNCA se guarda en plano: se guarda su hash SHA-256.
 * Cuando el cliente envía su refresh token, hasheamos lo recibido y buscamos
 * por hash. Si match → válido.
 *
 * Rotación estricta: cada refresh consume el token actual (lo marcamos como
 * revocado con reason='rotated') y emite uno nuevo. Reusar un refresh ya
 * rotado = 401 (posible señal de robo de token).
 *
 * Logout: marca la sesión como revoked con reason='logout'.
 *
 * Limpieza periódica: las sesiones con expires_at < now() o revoked_at < N
 * días pueden borrarse en un job.
 *
 * Ver `docs/12-seguridad-compliance.md §2.4` y `docs/DEVLOG.md`.
 */

import { pgTable, text, uuid, timestamp } from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '../utils/uuid';
import { platformUsers } from './platform-users';

export const platformUserSessions = pgTable('platform_user_sessions', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => generateUuidV7()),

  /** A qué super-admin pertenece esta sesión. */
  userId: uuid('user_id')
    .notNull()
    .references(() => platformUsers.id, { onDelete: 'cascade' }),

  /**
   * Hash SHA-256 (hex) del refresh token. UNIQUE para lookup rápido.
   * El token original solo lo ve el cliente — nosotros nunca lo persistimos.
   */
  tokenHash: text('token_hash').notNull().unique(),

  /** User-Agent capturado al crear la sesión (debug, antifraude). */
  userAgent: text('user_agent'),

  /**
   * IP del cliente. Texto en lugar de `inet` para evitar quirks de drizzle
   * con IPv6 mapped addresses (::ffff:127.0.0.1).
   */
  ip: text('ip'),

  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),

  /** Cuándo expira (default 30 días desde createdAt). */
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),

  /** Si está revocada, cuándo. NULL = activa. */
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),

  /**
   * Por qué se revocó. Útil para auditoría y debug.
   * Valores típicos: 'rotated' | 'logout' | 'admin' | 'expired'.
   */
  revokedReason: text('revoked_reason'),
});

export type PlatformUserSession = typeof platformUserSessions.$inferSelect;
export type NewPlatformUserSession = typeof platformUserSessions.$inferInsert;
