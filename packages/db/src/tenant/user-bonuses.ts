/**
 * Tabla `user_bonuses` (DB de tenant).
 *
 * Instancia de un bono asignado a un usuario concreto. La definición vive
 * en `bonus_definitions`; esto es el "estado vivo" — quién lo tiene,
 * cuánto le queda, en qué fase está.
 *
 * Ver `docs/15-engagement-promos.md §A3 / §A4`.
 *
 * Diseño MVP:
 *   - Sin wagering tracking todavía (`bonus_progress` queda para sprint
 *     posterior con engine de juegos). Hoy el flow simplificado es:
 *       grant → active → (cancel | force_clear | expire).
 *     No hay step de "wagering_in_progress".
 *   - `remaining_amount` empieza igual a `granted_amount`. Hoy NUNCA baja
 *     (no hay engine que consuma). Cuando llegue wagering, los bets
 *     debitarán de acá primero.
 *   - `force_clear` = el admin decide pasar las fichas pendientes al
 *     wallet real del user. Requiere permiso especial (audit_required).
 *   - `cancel` = anula sin entregar fichas al user. El funder recupera
 *     `remaining_amount`. Auditado.
 *   - `forfeit` = el user "pierde" el bono (típicamente: retiró antes de
 *     cumplir wagering). Las fichas se queman, no vuelven al funder.
 *     MVP no genera forfeits automáticos — solo manual desde admin.
 *
 * Idempotencia: cada user_bonus tiene `granted_by_idempotency_key` que
 * el endpoint exige. Evita grants duplicados ante retries de network.
 */

import {
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '../utils/uuid';
import { bonusDefinitions } from './bonus-definitions';
import { users } from './users';

export const userBonusStatusEnum = pgEnum('user_bonus_status', [
  'pending',
  'active',
  'wagering',
  'cleared',
  'cancelled',
  'expired',
  'forfeited',
]);

export const userBonuses = pgTable(
  'user_bonuses',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUuidV7()),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),

    definitionId: uuid('definition_id')
      .notNull()
      .references(() => bonusDefinitions.id),

    /** Monto otorgado al user (positivo, numeric(20,2)). NUNCA cambia. */
    grantedAmount: numeric('granted_amount', { precision: 20, scale: 2 }).notNull(),

    /**
     * Cuánto del bono queda vivo. Empieza == grantedAmount. Baja con
     * bets cuando exista wagering engine. Hoy: solo cambia a 0 en
     * force_clear o cancel.
     */
    remainingAmount: numeric('remaining_amount', { precision: 20, scale: 2 }).notNull(),

    status: userBonusStatusEnum('status').notNull().default('active'),

    /**
     * Quién pagó este grant concreto. Copiado de `bonus_definitions.funded_by_user_id`
     * AL MOMENTO DEL GRANT. Si la definición cambia de funder después, el
     * grant viejo mantiene el original.
     */
    fundedByUserId: uuid('funded_by_user_id')
      .notNull()
      .references(() => users.id),

    /**
     * Quién apretó el botón "otorgar". Para grant manual = cajero/admin.
     * Para auto (welcome/reload) = NULL (sistema).
     */
    grantedByUserId: uuid('granted_by_user_id').references(() => users.id),

    /**
     * Idempotency key del HTTP request que lo creó. UNIQUE.
     */
    grantIdempotencyKey: text('grant_idempotency_key').notNull(),

    /**
     * Tx de wallet que debitó al funder al otorgar. Sirve para join con
     * reportes y para reversa al cancelar (el revert linkea acá).
     */
    fundingTxId: uuid('funding_tx_id'),

    /**
     * Motivo libre — obligatorio para grants manuales. El doc dice "motivo
     * obligatorio en grant manual". Lo enforce el service.
     */
    reason: text('reason'),

    /**
     * Origen del evento: 'manual', 'deposit_approved', 'registration',
     * 'cashback_job', 'referral_ftd', etc. Para joins de reporting.
     */
    sourceEvent: jsonb('source_event').notNull().default({}),

    grantedAt: timestamp('granted_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),

    activatedAt: timestamp('activated_at', { withTimezone: true, mode: 'date' }),

    clearedAt: timestamp('cleared_at', { withTimezone: true, mode: 'date' }),

    cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'date' }),

    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),

    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('user_bonuses_grant_idempotency_uniq').on(table.grantIdempotencyKey),
    index('user_bonuses_user_status_idx').on(table.userId, table.status),
    index('user_bonuses_status_expires_idx').on(table.status, table.expiresAt),
    index('user_bonuses_definition_idx').on(table.definitionId),
  ],
);

export type UserBonus = typeof userBonuses.$inferSelect;
export type NewUserBonus = typeof userBonuses.$inferInsert;
