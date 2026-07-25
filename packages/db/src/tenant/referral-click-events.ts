/**
 * Tabla `referral_click_events` (DB de tenant).
 *
 * Registra cada clic en un link de referido (`/r/{code}`).
 * Solo lectura — no afecta balance ni jerarquía.
 * Usada para métricas del operador (clicks, funnel).
 *
 * Phase 1: click tracking básico.
 * Phase 2: se usa para atribución de registros (last-touch via cookie).
 */

import { index, inet, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '../utils/uuid';
import { users } from './users';

export const referralClickEvents = pgTable(
  'referral_click_events',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),

    /** El código de referido clickeado (== referral_code del referrer). */
    referralCode: text('referral_code').notNull(),

    /** FK al user que recibe el click (el referrer). */
    referrerUserId: uuid('referrer_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** IP del visitante (para métricas y futura antifraude). */
    ip: inet('ip'),

    /** User-Agent del navegador. */
    userAgent: text('user_agent'),

    /** URL de origen (referer header). */
    referer: text('referer'),

    /** Cuándo se produjo el click. */
    clickedAt: timestamp('clicked_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Queries típicas: "dame todos los clicks de este referrer en los
    // últimos 30 días" → index por referrer_user_id + clicked_at.
    index('referral_click_referrer')
      .on(table.referrerUserId, table.clickedAt),
    // Lookup por código (fase 2: resolve code → referrer).
    index('referral_click_code')
      .on(table.referralCode),
  ],
);

export type ReferralClickEvent = typeof referralClickEvents.$inferSelect;
export type NewReferralClickEvent = typeof referralClickEvents.$inferInsert;
