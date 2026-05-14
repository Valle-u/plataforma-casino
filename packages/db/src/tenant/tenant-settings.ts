/**
 * Tabla `tenant_settings` (DB de tenant).
 *
 * Key-value store de configuración del tenant. Cada fila es un setting
 * con `key` como PK (lookup directo, sin scan) y `value` como JSONB
 * (flexible: number/string/bool/object).
 *
 * Convención de keys (namespacing dot-separated):
 *   - `fraud.suspected_threshold` (number, default 70)
 *   - `fraud.welcome_block_threshold` (number, default 90)
 *   - `branding.primary_color` (string)
 *   - `wallet.daily_load_limit_chips` (number)
 *   - etc.
 *
 * Diseño:
 *   - PK `key` text — lookups O(1).
 *   - `value` jsonb — el caller parsea según convención de cada key.
 *   - `updated_by_user_id` para audit.
 *   - Sin DELETE (set null si querés "borrar" — el caller decide qué
 *     hacer con null). MVP no expone delete; PATCH con value=null
 *     marca el setting como "unset".
 */

import {
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users';

export const tenantSettings = pgTable('tenant_settings', {
  key: text('key').primaryKey(),

  value: jsonb('value').notNull(),

  updatedByUserId: uuid('updated_by_user_id').references(() => users.id),

  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

export type TenantSetting = typeof tenantSettings.$inferSelect;
export type NewTenantSetting = typeof tenantSettings.$inferInsert;
