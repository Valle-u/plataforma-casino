/**
 * Tabla `roles` (DB de tenant).
 *
 * Cada rol es un agrupador de permisos atómicos (ver tabla `permissions`).
 * En el seed inicial vienen los roles base del sistema (admin_tenant, socio,
 * distribuidor, cajero, empleado, usuario_final). El admin del tenant puede
 * crear roles custom adicionales.
 *
 * Ver `docs/03-jerarquia-roles.md`.
 */

import { boolean, pgTable, text, uuid, timestamp } from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '../utils/uuid';

export const roles = pgTable('roles', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => generateUuidV7()),

  /** Código único, lowercase con underscores (ej: 'admin_tenant', 'cajero'). */
  code: text('code').notNull().unique(),

  /** Nombre visible en UI. */
  name: text('name').notNull(),

  /** Descripción larga del rol. */
  description: text('description'),

  /**
   * is_system=true para los roles base que no se pueden eliminar.
   * Custom roles creados por el Admin Tenant tienen is_system=false.
   */
  isSystem: boolean('is_system').notNull().default(false),

  /**
   * Si true, todo user que tenga este rol DEBE tener 2FA habilitado para
   * usar endpoints autenticados. Si el user todavía no setupeó 2FA, podrá
   * loguearse y acceder solo a los endpoints marcados con
   * `@AllowWithoutTwoFa()` (típicamente: GET /me, init/confirm 2FA, logout).
   *
   * Default false (jugadores y roles custom no exigen 2FA salvo que el
   * Admin Tenant lo active explícitamente).
   *
   * Seed setea true para admin_tenant, socio, distribuidor, cajero.
   */
  requiresTwoFa: boolean('requires_two_fa').notNull().default(false),

  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),

  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;
