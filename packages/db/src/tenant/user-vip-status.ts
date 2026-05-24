/**
 * Tabla `user_vip_status` (DB de tenant). Sprint 52.3.
 *
 * Una fila por user — su tier VIP actual + volumen computado en la
 * última recompute. Updated (no append) — el histórico de cambios de
 * tier vive en audit_log (action_code='vip.tier_changed').
 *
 * Recompute strategy:
 *   - Lazy on read: si el `recomputedAt` es viejo (> 1h), el getMyStatus
 *     trigerea un recompute antes de devolver. Mantiene fresco sin cron.
 *   - Eager on relevant events (futuro): después de cada bet/win grande,
 *     trigger un recompute. Simple para MVP — lazy alcanza.
 *   - Cron (futuro sprint): recompute global cada noche para coherencia.
 *
 * `volume30d` es snapshot — para historia detallada hay que ir a
 * wallet_transactions.
 */

import {
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users';

export const userVipStatus = pgTable('user_vip_status', {
  /**
   * userId es PK — un user, una fila. CASCADE para limpieza si se borra
   * el user.
   */
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),

  /**
   * Code del vip_tier actual del user (FK lógico, no estricto — si
   * admin archiva un tier, los users que estaban ahí siguen referenciando
   * el code y se recomputan al próximo trigger).
   */
  currentTierCode: text('current_tier_code').notNull().default('bronze'),

  /** Sum |bet| últimos 30d al momento del recompute. */
  volume30d: numeric('volume_30d', { precision: 20, scale: 2 })
    .notNull()
    .default('0'),

  /** Cuándo se hizo el último recompute. Usado para lazy recompute. */
  recomputedAt: timestamp('recomputed_at', {
    withTimezone: true,
    mode: 'date',
  })
    .notNull()
    .defaultNow(),

  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
});

export type UserVipStatus = typeof userVipStatus.$inferSelect;
export type NewUserVipStatus = typeof userVipStatus.$inferInsert;
