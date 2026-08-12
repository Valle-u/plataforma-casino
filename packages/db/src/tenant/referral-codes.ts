/**
 * referral_codes — códigos de referido de CAMPAÑA (además del base).
 *
 * El código BASE de cada operador (socio/distri/cajero) sigue viviendo en
 * `users.referral_code` (= username). Esta tabla guarda los códigos EXTRA que
 * un usuario crea para campañas (ej. "Instagram"), cada uno con su etiqueta
 * interna y su código auto-generado, para trackear métricas por campaña.
 *
 * Quién puede tener filas acá: operadores (socio/distri/cajero) + admin_tenant.
 * El admin NO tiene código base pero SÍ puede crear campañas.
 *
 * Las métricas por código salen de agrupar referral_click_events y
 * referral_attributions por `referral_code` (que ya guardan el código usado).
 *
 * Leyes: P1 (permiso+scope en los endpoints), P4 (multi-tenant). Sin comisiones.
 */

import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

export const referralCodes = pgTable(
  'referral_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Dueño del código (operador o admin). */
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Código auto-generado, único en el tenant (no colisiona con usernames). */
    code: text('code').notNull().unique(),
    /** Etiqueta interna que le pone el dueño (ej. "Instagram"). */
    label: text('label').notNull(),
    /** Si está inactivo, el link deja de atribuir (las métricas se conservan). */
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    ownerIdx: index('referral_codes_owner_idx').on(table.ownerUserId),
  }),
);

export type ReferralCode = typeof referralCodes.$inferSelect;
export type NewReferralCode = typeof referralCodes.$inferInsert;
