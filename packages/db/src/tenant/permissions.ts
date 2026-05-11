/**
 * Tabla `permissions` (DB de tenant).
 *
 * Catálogo de permisos atómicos disponibles en el sistema.
 * Igual en todas las DBs de tenant — se seedea con un set fijo definido en
 * `docs/03-jerarquia-roles.md §4`.
 *
 * Cada permiso lleva flags:
 *   - audit_required: si la acción debe loggearse en audit_log.
 *   - is_delegatable: si quien lo tiene puede regalárselo a un subordinado
 *     (ver docs/03 §7.2 para la lista de no-delegables).
 */

import { boolean, pgTable, text } from 'drizzle-orm/pg-core';

export const permissions = pgTable('permissions', {
  /** Código único: 'wallet.load', 'deposits.approve', etc. */
  code: text('code').primaryKey(),

  /** Categoría para agrupar en UI: 'wallet', 'deposits', 'reports', etc. */
  category: text('category').notNull(),

  /** Descripción visible en UI / matriz de permisos. */
  description: text('description').notNull(),

  /** Si la ejecución debe loggearse en audit_log. */
  auditRequired: boolean('audit_required').notNull().default(false),

  /** Si un usuario que tiene este permiso puede otorgarlo a subordinados. */
  isDelegatable: boolean('is_delegatable').notNull().default(true),
});

export type Permission = typeof permissions.$inferSelect;
export type NewPermission = typeof permissions.$inferInsert;
