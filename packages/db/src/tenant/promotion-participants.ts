/**
 * Tabla `promotion_participants` (DB de tenant).
 *
 * Estado vivo del user en una promotion. Reusable entre types:
 *   - login_streak: `{ streak, lastClaimDay }`.
 *   - missions: `{ progress: { metricA: 100, metricB: 50 }, completed: false }`.
 *   - lottery_tickets: `{ ticketCount, lastGenerationRoundId }`.
 *   - level_chests: `{ xp, level, chestsClaimedLevels: [1,2,3] }`.
 *
 * Cada type interpreta `current_progress` JSONB a su manera.
 *
 * UNIQUE (promotion_id, user_id) — un user solo tiene UNA fila per promo
 * (no historizamos cambios de estado acá; los rewards quedan en
 * `promotion_rewards`).
 */

import {
  index,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '../utils/uuid';
import { promotions } from './promotions';
import { users } from './users';

export const promotionParticipants = pgTable(
  'promotion_participants',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),

    promotionId: uuid('promotion_id')
      .notNull()
      .references(() => promotions.id),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),

    /** State libre, interpretado por el service del type. */
    currentProgress: jsonb('current_progress').notNull().default({}),

    joinedAt: timestamp('joined_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('promotion_participants_promo_user_uniq').on(
      table.promotionId,
      table.userId,
    ),
    index('promotion_participants_user_idx').on(table.userId),
  ],
);

export type PromotionParticipant = typeof promotionParticipants.$inferSelect;
export type NewPromotionParticipant = typeof promotionParticipants.$inferInsert;
