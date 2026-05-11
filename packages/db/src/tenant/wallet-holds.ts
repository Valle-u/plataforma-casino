/**
 * Tabla `wallet_holds` (DB de tenant).
 *
 * Reserva de fichas: el monto está "comprometido" pero todavía no se gastó.
 * Usado por:
 *   - Retiros pendientes (`docs/05 §7`): mientras el retiro espera aprobación,
 *     las fichas no se pueden volver a apostar.
 *   - Promos con premio fijo (sorteos, liga, jackpots): el funder reserva
 *     fichas para garantizar el payout.
 *   - Bonos con wagering: las fichas del bono viven en hold hasta cumplir
 *     wagering (ver `docs/05 §10`).
 *
 * Mecánica:
 *   - Crear hold: incrementa `wallets.locked_balance` y decrementa nada (o
 *     decrementa `balance` según el caso — el WalletService decide).
 *   - Soltar hold (`released_at`): inverso.
 *   - `expires_at` opcional: cuando se vence, un job nocturno libera
 *     automáticamente (futuro: BullMQ).
 *
 * En esta primera sesión la tabla queda creada y testeada para forma, pero
 * los flujos que la usan (retiros, promos) llegan en sesiones siguientes.
 */

import { numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { check } from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '../utils/uuid';
import { wallets } from './wallets';

export const walletHolds = pgTable(
  'wallet_holds',
  {
    id: uuid('id').primaryKey().$defaultFn(generateUuidV7),

    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id),

    amount: numeric('amount', { precision: 20, scale: 2 }).notNull(),

    /**
     * Razón legible. Convenciones:
     *   'withdrawal:<withdrawal_id>'
     *   'bonus:<bonus_id>'
     *   'promo_reserve:<promo_id>'
     */
    reason: text('reason').notNull(),

    /** Tipo de entidad que motiva el hold (para joins): 'withdrawal', 'bonus', etc. */
    relatedEntityType: text('related_entity_type'),

    /** ID de esa entidad. */
    relatedEntityId: uuid('related_entity_id'),

    /** Expiración automática. NULL = hold indefinido hasta release manual. */
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),

    /** Cuando se liberó. NULL mientras está activo. */
    releasedAt: timestamp('released_at', { withTimezone: true, mode: 'date' }),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [check('wallet_hold_amount_positive', sql`${table.amount} > 0`)],
);

export type WalletHold = typeof walletHolds.$inferSelect;
export type NewWalletHold = typeof walletHolds.$inferInsert;
