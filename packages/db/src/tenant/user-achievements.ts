/**
 * Tabla `user_achievements` (DB de tenant).
 *
 * Junction entre `users` y `achievement_definitions`. Una fila por
 * (user, achievement_code) — cuando el user desbloquea un logro, se
 * inserta. Append-only (no se borra ni se "re-bloquea").
 *
 * Sprint 52.2.
 *
 * Reglas:
 *   - UNIQUE (user_id, achievement_code) — un user no puede tener el
 *     mismo logro dos veces.
 *   - `rewardWalletTxId` link a la wallet_tx donde se mintea la
 *     recompensa. NULL si la def tenía rewardChips=0 o si el mint falló
 *     (fail-soft: el achievement se otorga igual, el admin reconcilia).
 *   - `metadata jsonb` para guardar contexto del unlock (e.g. snapshot
 *     del valor que disparó el predicate, depositId que gatilló
 *     first_deposit, etc.).
 *
 * Append-only por integrity — si hay que "revertir" un unlock por
 * fraude, INSERT a audit_log + admin tool específica (no DELETE).
 */

import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '../utils/uuid';
import { users } from './users';
import { walletTransactions } from './wallet-transactions';

export const userAchievements = pgTable(
  'user_achievements',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /**
     * Code del achievement (FK lógica a achievement_definitions.code, no
     * estricta con DB constraint — si admin archiva una def, los unlocks
     * históricos siguen referenciando el code aunque la def ya no exista).
     */
    achievementCode: text('achievement_code').notNull(),

    unlockedAt: timestamp('unlocked_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),

    /** Wallet tx donde se mintearon los chips. NULL si no hubo reward. */
    rewardWalletTxId: uuid('reward_wallet_tx_id').references(
      () => walletTransactions.id,
    ),

    /** Contexto del unlock (snapshot, ID del evento triggering, etc.). */
    metadata: jsonb('metadata').notNull().default({}),
  },
  (table) => [
    // Un user, un código, una vez.
    uniqueIndex('user_achievements_user_code_unique').on(
      table.userId,
      table.achievementCode,
    ),
    // Hot path: listar todos los unlocks de un user.
    index('user_achievements_user_unlocked').on(
      table.userId,
      table.unlockedAt,
    ),
  ],
);

export type UserAchievement = typeof userAchievements.$inferSelect;
export type NewUserAchievement = typeof userAchievements.$inferInsert;
