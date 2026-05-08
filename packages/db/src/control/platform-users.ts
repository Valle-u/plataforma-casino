/**
 * Tabla `platform_users` (DB de control).
 *
 * Super-administradores de la plataforma — el dueño del producto y su equipo.
 * Tienen permisos `platform.*` y NO viven en las DBs de tenant.
 *
 * Su scope es global: ven todos los tenants, gestionan altas/bajas/suspensiones,
 * cobranza de comisiones, métricas consolidadas.
 *
 * Referencia en docs/03-jerarquia-roles.md y docs/12-seguridad-compliance.md.
 */

import { pgTable, text, uuid, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '../utils/uuid';

export const platformUserStatusEnum = pgEnum('platform_user_status', [
  'active',
  'suspended',
]);

export const platformUsers = pgTable('platform_users', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => generateUuidV7()),

  /** Email único, usado como identificador de login. */
  email: text('email').notNull().unique(),

  /** Hash de password (Argon2id) — generado por el backend, nunca llega plano. */
  passwordHash: text('password_hash').notNull(),

  /** Nombre visible en panel y audit log. */
  displayName: text('display_name').notNull(),

  /**
   * Secret TOTP cifrado (pgcrypto a nivel app).
   * Si NULL, el usuario aún no configuró 2FA (debería forzarse al primer login
   * según política — super-admin SIEMPRE debe tener 2FA).
   */
  twoFaSecret: text('two_fa_secret'),

  /** Estado actual del usuario. */
  status: platformUserStatusEnum('status').notNull().default('active'),

  /** Último login exitoso (para alertas y auditoría). */
  lastLoginAt: timestamp('last_login_at', { withTimezone: true, mode: 'date' }),

  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),

  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

export type PlatformUser = typeof platformUsers.$inferSelect;
export type NewPlatformUser = typeof platformUsers.$inferInsert;
