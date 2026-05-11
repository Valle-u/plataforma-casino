/**
 * Tabla `user_permission_overrides` (DB de tenant).
 *
 * Permisos individuales otorgados o revocados a un user, por encima/debajo
 * de los que vienen de sus roles.
 *
 * Cálculo de permisos efectivos:
 *   permisos(user) = UNION role_permissions de sus user_roles
 *                  + overrides con effect = 'grant'
 *                  − overrides con effect = 'revoke'
 *
 * Ver `docs/03-jerarquia-roles.md §3` y `§7.3` (cascada).
 *
 * Cascada al revocar (próximo sprint): cuando se quita un permiso al user X,
 * todos los overrides cuya `granted_by_chain` contiene a X se revocan también.
 */

import { pgEnum, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { permissions } from './permissions';
import { users } from './users';

export const overrideEffectEnum = pgEnum('override_effect', ['grant', 'revoke']);

export const userPermissionOverrides = pgTable(
  'user_permission_overrides',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    permissionCode: text('permission_code')
      .notNull()
      .references(() => permissions.code, { onDelete: 'cascade' }),

    /** 'grant' suma el permiso. 'revoke' lo resta del set efectivo. */
    effect: overrideEffectEnum('effect').notNull(),

    /** User que otorgó/revocó este override. NULL si fue por sistema/seed. */
    grantedBy: uuid('granted_by'),

    /**
     * Cadena de delegación (uuid[]) desde el origen hasta `grantedBy`.
     * Permite cascada al revocar (`docs/03 §7.3`).
     * En MVP se llena pero no se usa todavía para cascada — esa lógica
     * llega en sprint posterior.
     */
    grantedByChain: uuid('granted_by_chain').array().notNull().default([]),

    /** Motivo del override (obligatorio para revoke por convención). */
    reason: text('reason'),

    grantedAt: timestamp('granted_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.permissionCode] })],
);

export type UserPermissionOverride = typeof userPermissionOverrides.$inferSelect;
export type NewUserPermissionOverride = typeof userPermissionOverrides.$inferInsert;
