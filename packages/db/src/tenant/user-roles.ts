/**
 * Tabla `user_roles` (DB de tenant).
 *
 * Asignación de roles a users. Multi-rol: un mismo user puede tener varios
 * roles simultáneos (ej. socio + empleado del tenant). El set efectivo de
 * permisos es la UNIÓN de los permisos de todos sus roles.
 *
 * Ver `docs/03-jerarquia-roles.md §3 + §6.Multi-rol`.
 */

import { pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';
import { roles } from './roles';

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),

    /** Quién otorgó el rol. NULL si fue por seed/sistema. */
    grantedBy: uuid('granted_by'),

    grantedAt: timestamp('granted_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.roleId] })],
);

export type UserRole = typeof userRoles.$inferSelect;
export type NewUserRole = typeof userRoles.$inferInsert;
