/**
 * Tabla `tenant_settings_history` (DB de tenant).
 *
 * Append-only. Cada `set` o `unset` de un setting crea una fila acá
 * con el valor anterior + nuevo + actor + timestamp. Permite:
 *   - Ver evolución temporal de un setting ("¿cuándo cambió el
 *     fraud.suspected_threshold y a qué valor?").
 *   - Forensics: en una crisis, saber qué settings cambiaron
 *     recientemente sin tener que parsear audit_log entries (que ya
 *     existen pero con shape genérica).
 *   - Rollback manual: el admin ve el value anterior y lo re-setea.
 *
 * Diseño:
 *   - `previous_value` NULL si es el primer set (no había value previo).
 *   - `new_value` NULL si fue unset.
 *   - `action` enum {'set', 'unset'} para clarity.
 *   - Index `(key, changed_at DESC)` para "últimos N cambios de key X".
 *   - Sin FK a `tenant_settings.key` — el current row puede haber sido
 *     borrado pero el historial sobrevive.
 */

import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '../utils/uuid';
import { users } from './users';

export const tenantSettingActionEnum = pgEnum('tenant_setting_action', [
  'set',
  'unset',
]);

export const tenantSettingsHistory = pgTable(
  'tenant_settings_history',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),

    key: text('key').notNull(),

    /** Value antes del cambio. NULL si era el primer set. */
    previousValue: jsonb('previous_value'),

    /** Value después del cambio. NULL si fue unset. */
    newValue: jsonb('new_value'),

    action: tenantSettingActionEnum('action').notNull(),

    changedByUserId: uuid('changed_by_user_id').references(() => users.id),

    changedAt: timestamp('changed_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('tenant_settings_history_key_changed_idx').on(
      table.key,
      table.changedAt,
    ),
    index('tenant_settings_history_changed_at_idx').on(table.changedAt),
  ],
);

export type TenantSettingHistory = typeof tenantSettingsHistory.$inferSelect;
export type NewTenantSettingHistory = typeof tenantSettingsHistory.$inferInsert;
