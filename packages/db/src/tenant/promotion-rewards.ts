/**
 * Tabla `promotion_rewards` (DB de tenant).
 *
 * Cada entrega de premio (giro de ruleta diaria, ticket ganador, claim de
 * login streak, completion de misión, etc.) genera una fila. Es la fuente
 * autoritativa de "qué premios dio cada promotion" — base para auditoría
 * y reportes.
 *
 * Diseño:
 *   - `prize jsonb` describe el premio entregado: `{ kind: 'chips',
 *     amount: 500 }` | `{ kind: 'bonus', definitionId, amount }` |
 *     `{ kind: 'free_spins', count, gameId }` | `{ kind: 'try_again' }`.
 *   - `walletTxId` link a la wallet_transaction si el premio fue chips
 *     o si causó debit/credit. NULL si no afecta wallet (try_again).
 *   - `bonusId` link a user_bonuses si el premio fue otorgar un bono.
 *   - `idempotencyKey` UNIQUE intra-promotion — evita doble-grant del
 *     mismo evento (e.g. dos spins concurrentes del mismo day-anchor).
 *   - `metadata jsonb` para data específica del type: RNG seed del
 *     wheel, segment ganado, ticket number, mission progress snapshot.
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
import { promotions } from './promotions';
import { userBonuses } from './user-bonuses';
import { users } from './users';
import { walletTransactions } from './wallet-transactions';

export const promotionRewards = pgTable(
  'promotion_rewards',
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

    /** Snapshot del premio entregado. */
    prize: jsonb('prize').notNull(),

    /** Link al wallet_tx que materializó el crédito (NULL si try_again). */
    walletTxId: uuid('wallet_tx_id').references(() => walletTransactions.id),

    /** Link al user_bonus si el premio fue otorgar un bono. */
    bonusId: uuid('bonus_id').references(() => userBonuses.id),

    /**
     * Idempotency key intra-promotion. Para daily_wheel:
     * `daily_spin:<userId>:<dayAnchor>` evita doble-spin en el mismo día.
     */
    idempotencyKey: text('idempotency_key').notNull(),

    metadata: jsonb('metadata').notNull().default({}),

    grantedAt: timestamp('granted_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('promotion_rewards_promo_idem_uniq').on(
      table.promotionId,
      table.idempotencyKey,
    ),
    index('promotion_rewards_user_granted_idx').on(table.userId, table.grantedAt),
    index('promotion_rewards_promotion_idx').on(table.promotionId),
  ],
);

export type PromotionReward = typeof promotionRewards.$inferSelect;
export type NewPromotionReward = typeof promotionRewards.$inferInsert;
