/**
 * Tabla `user_hierarchy` (DB de tenant).
 *
 * Histórica: cada fila representa una relación parent-child con un
 * período de validez (`since` → `until`). Cuando un user cambia de
 * parent, la fila vieja se CIERRA (`until = now()`) y se abre una
 * nueva. NO se borran filas — permite reconstruir relaciones del
 * pasado.
 *
 * Ver `docs/03 §3` y `docs/04 §3 user_hierarchy`.
 *
 * **Constraint clave**: un user solo puede tener UN parent activo a
 * la vez (`until IS NULL`). Se enforce con un UNIQUE INDEX parcial
 * `WHERE until IS NULL`.
 *
 * `relation_type` es texto libre con convenciones:
 *   - 'cajero_de_socio'
 *   - 'cajero_de_distribuidor'
 *   - 'distribuidor_de_socio'
 *   - 'jugador_de_cajero'
 *   - 'empleado_de_socio'
 *
 * La capa de aplicación decide la convención. La tabla solo modela
 * relaciones genéricas parent → child.
 *
 * Self-reference: la FK del parent apunta al mismo `users` table.
 * `ON DELETE SET NULL` en parent_user_id: si se borra un parent
 * (raro, soft-delete preferido), las relaciones vivas quedan
 * huérfanas — la app debe detectarlas y reasignar al "abuelo"
 * según `docs/03 §11`.
 */

import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { generateUuidV7 } from '../utils/uuid';
import { users } from './users';

export const userHierarchy = pgTable(
  'user_hierarchy',
  {
    id: uuid('id').primaryKey().$defaultFn(generateUuidV7),

    /** User "hijo" (subordinado). NOT NULL, FK a users. */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /**
     * User "padre" (superior). NULL solo en relaciones de "root":
     * típicamente un admin_tenant sin parent. En MVP las relaciones
     * concretas siempre tienen parent — root queda fuera del esquema.
     */
    parentUserId: uuid('parent_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    /** Convención libre: 'cajero_de_socio', 'jugador_de_cajero', etc. */
    relationType: text('relation_type').notNull(),

    /** Inicio del período de validez. Por default = ahora. */
    since: timestamp('since', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),

    /**
     * Fin del período. NULL = relación ACTIVA actualmente.
     * Cuando el user cambia de parent, se setea `until = now()` en
     * la fila vieja y se inserta una nueva con `until = NULL`.
     */
    until: timestamp('until', { withTimezone: true, mode: 'date' }),

    /** Auditoría: quién creó esta fila. */
    createdBy: uuid('created_by').references(() => users.id),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Constraint clave: un user solo puede tener UN parent activo
    // a la vez. Parcial: solo aplica cuando until IS NULL.
    uniqueIndex('user_hierarchy_one_active_parent')
      .on(table.userId)
      .where(sql`${table.until} IS NULL`),
  ],
);

export type UserHierarchy = typeof userHierarchy.$inferSelect;
export type NewUserHierarchy = typeof userHierarchy.$inferInsert;
