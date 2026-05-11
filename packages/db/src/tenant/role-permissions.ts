/**
 * Tabla `role_permissions` (DB de tenant).
 *
 * Permisos por defecto de cada rol. Cuando se crea un user con un rol,
 * automáticamente "hereda" estos permisos (vía cálculo de set efectivo).
 *
 * El cálculo de permisos efectivos:
 *   permisos(user) = UNION role_permissions de sus user_roles
 *                  + user_permission_overrides (grant)
 *                  − user_permission_overrides (revoke)
 *
 * Ver `docs/03-jerarquia-roles.md §3`.
 */

import { pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { roles } from './roles';
import { permissions } from './permissions';

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),

    permissionCode: text('permission_code')
      .notNull()
      .references(() => permissions.code, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.permissionCode] })],
);

export type RolePermission = typeof rolePermissions.$inferSelect;
export type NewRolePermission = typeof rolePermissions.$inferInsert;
