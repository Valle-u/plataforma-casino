/**
 * Tabla `self_exclusions` (DB de tenant).
 *
 * Histórica: cada exclusión es una fila. Si el user se auto-excluye
 * temporalmente y después se re-excluye, son DOS rows. NO update de
 * filas viejas — solo el `status` puede pasar a 'expired' (vía cron
 * que veré post-MVP) o 'revoked' (manual admin).
 *
 * Spec: `docs/12-seguridad-compliance.md §6.3`.
 *
 * Reglas:
 *   - `type='cool_off'`: bloqueo corto self-service (24h-7d típico).
 *   - `type='temporary'`: bloqueo más largo (1mes-1año).
 *   - `type='permanent'`: bloqueo definitivo. `ends_at` NULL. Solo el
 *     admin puede revocar via `status='revoked'` con audit severidad
 *     alta + razón obligatoria.
 *
 * Enforcement (Sprint 33):
 *   - `TenantAuthService.login` rechaza si hay row con `status='active'`
 *     y (`ends_at IS NULL` OR `ends_at > NOW()`).
 *   - Sesiones activas NO se invalidan — el user simplemente no podrá
 *     re-loguearse. Para invalidar sesiones activas, sumar después un
 *     hook que limpie `user_sessions` al crear la exclusion.
 *
 * Index parcial UNIQUE: un user no puede tener > 1 exclusión 'active'
 * a la vez. Si quiere endurecer la exclusión (e.g. de temporary a
 * permanent), el admin revoca la actual y crea una nueva.
 */

import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { generateUuidV7 } from '../utils/uuid';
import { users } from './users';

export const selfExclusionTypeEnum = pgEnum('self_exclusion_type', [
  'cool_off',
  'temporary',
  'permanent',
]);

export const selfExclusionStatusEnum = pgEnum('self_exclusion_status', [
  'active',
  'expired',
  'revoked',
]);

export const selfExclusions = pgTable(
  'self_exclusions',
  {
    id: uuid('id').primaryKey().$defaultFn(generateUuidV7),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    type: selfExclusionTypeEnum('type').notNull(),

    startsAt: timestamp('starts_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),

    /** NULL para permanent. Para cool_off/temporary: cuando vence. */
    endsAt: timestamp('ends_at', { withTimezone: true, mode: 'date' }),

    /** Free text del user o del admin. */
    reason: text('reason'),

    /**
     * Quién creó la exclusión. Si igual a `userId` → self-service.
     * Si distinto → admin force (audit severity:high).
     */
    createdByUserId: uuid('created_by_user_id').references(() => users.id),

    /** Quién revocó (NULL si nunca se revocó). */
    revokedByUserId: uuid('revoked_by_user_id').references(() => users.id),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    revokedReason: text('revoked_reason'),

    status: selfExclusionStatusEnum('status').notNull().default('active'),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Un user solo puede tener UNA exclusion activa a la vez.
    uniqueIndex('self_exclusions_user_active_unique')
      .on(table.userId)
      .where(sql`status = 'active'`),
    // Hot path: chequear si user tiene exclusion activa en login.
    index('self_exclusions_user_status').on(table.userId, table.status),
  ],
);

export type SelfExclusion = typeof selfExclusions.$inferSelect;
export type NewSelfExclusion = typeof selfExclusions.$inferInsert;
