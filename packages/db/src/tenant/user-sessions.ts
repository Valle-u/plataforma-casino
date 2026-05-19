/**
 * Tabla `user_sessions` (DB de tenant).
 *
 * Mismo patrón que `platform_user_sessions` (DB de control), pero para los
 * usuarios operativos del tenant.
 *
 * Cada login crea una fila con un refresh token (string random opaco).
 * El token nunca se guarda en plano: SHA-256 hex del token va en token_hash.
 *
 * Rotación estricta: cada refresh consume el token actual (revoked_at +
 * revoked_reason='rotated') y emite uno nuevo.
 *
 * Ver `docs/12-seguridad-compliance.md §2.4` y `docs/DEVLOG.md` para detalles.
 */

import { pgTable, text, uuid, timestamp } from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '../utils/uuid';
import { users } from './users';

export const userSessions = pgTable('user_sessions', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => generateUuidV7()),

  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),

  /** SHA-256 hex del refresh token. UNIQUE para lookup rápido. */
  tokenHash: text('token_hash').notNull().unique(),

  userAgent: text('user_agent'),
  ip: text('ip'),

  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),

  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),

  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),

  /** 'rotated' | 'logout' | 'admin' | 'expired' */
  revokedReason: text('revoked_reason'),

  /**
   * Sprint 37: si esta sesión fue creada por un admin operando como
   * otro user (impersonate), apunta al admin original. NULL en sesiones
   * normales. Se usa para:
   *   - Audit: cada acción de esta sesión sabe el "real actor" + el
   *     "impersonator" para forensics.
   *   - UI: banner persistente en el frontend cuando la sesión es
   *     impersonada, con "Volver a [admin]" como escape.
   *
   * ON DELETE SET NULL: si el admin se borra, la sesión histórica
   * pierde el link pero sigue válida.
   */
  impersonatedByUserId: uuid('impersonated_by_user_id').references(
    () => users.id,
    { onDelete: 'set null' },
  ),
});

export type UserSession = typeof userSessions.$inferSelect;
export type NewUserSession = typeof userSessions.$inferInsert;
