/**
 * referral_attributions — atribución de un jugador registrado a un referrer.
 *
 * Fase 2 del sistema de referidos: auto-registration.
 *
 * Cada jugador registrado vía un link de referido tiene UNA fila acá.
 * Si se registró sin link (orgánico), NO tiene fila.
 *
 * Leyes: R5 (solo usuario_final), P4 (multi-tenant).
 */

import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

export const referralAttributions = pgTable('referral_attributions', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** El jugador registrado (usuario_final, único por atribución). */
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** El código de referido usado (denormalizado para queries). */
  referralCode: text('referral_code').notNull(),
  /** El referrer (socio/distri/cajeroDueño del código). */
  referrerUserId: uuid('referrer_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** 'click' | 'manual_code' — MVP solo 'click'. */
  attributionMethod: text('attribution_method').notNull().default('click'),
  /** Cuándo se atribuyó (al registrarse). */
  attributedAt: timestamp('attributed_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  /** IP del registro. */
  ip: text('ip'),
  /** User-Agent del registro. */
  userAgent: text('user_agent'),
  /** Referer header del registro. */
  referer: text('referer'),
});

export type ReferralAttribution =
  typeof referralAttributions.$inferSelect;
export type NewReferralAttribution =
  typeof referralAttributions.$inferInsert;
