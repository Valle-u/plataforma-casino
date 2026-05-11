/**
 * Tabla `wallets` (DB de tenant).
 *
 * Una wallet por user. Jugadores, cajeros, distribuidores, socios, admin —
 * todos tienen wallet. La diferencia operativa es CÓMO usan el saldo:
 *   - Jugador: apuesta / gana / deposita / retira.
 *   - Cajero/Distribuidor/Socio: transfiere FROM su wallet a wallets debajo.
 *   - Admin Tenant: puede MINT/BURN (crear/destruir fichas desde la nada).
 *
 * Reglas duras (ver `docs/05-flujos-fichas.md §1`):
 *   - `balance` y `locked_balance` SIEMPRE ≥ 0 (CHECK constraint).
 *   - Una sola wallet por user (UNIQUE user_id).
 *   - `version` se incrementa automáticamente en cada UPDATE vía trigger.
 *     Esto da locking optimista para detectar mutaciones concurrentes.
 *   - **NINGUNA mutación de `balance` sin TX Postgres que también inserte
 *     una fila en `wallet_transactions`**. Esto se enforce a nivel de
 *     aplicación (WalletService) — no hay trigger DB porque drizzle no
 *     juega bien con triggers complejos.
 *
 * Convenciones de tipo numérico (`docs/04 §4`):
 *   - `numeric(20,2)` siempre. Nunca `float`/`double` (drift de redondeo
 *     en operaciones financieras).
 *
 * `currency` siempre 'CHIPS' en MVP. Reservado por si en v2 sumamos
 * "wallet real money" además de la wallet de fichas.
 */

import { check, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { generateUuidV7 } from '../utils/uuid';
import { users } from './users';

export const wallets = pgTable(
  'wallets',
  {
    id: uuid('id').primaryKey().$defaultFn(generateUuidV7),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** Fichas disponibles para gastar/transferir. Siempre ≥ 0. */
    balance: numeric('balance', { precision: 20, scale: 2 }).notNull().default('0'),

    /**
     * Fichas reservadas: bonos con wagering pendiente + retiros en hold +
     * fondos comprometidos para promos. NO se pueden gastar mientras estén
     * acá. Siempre ≥ 0.
     */
    lockedBalance: numeric('locked_balance', { precision: 20, scale: 2 })
      .notNull()
      .default('0'),

    /** Siempre 'CHIPS' en MVP. Reservado para wallets multi-currency en v2. */
    currency: text('currency').notNull().default('CHIPS'),

    /**
     * Optimistic locking: cada UPDATE incrementa esta versión. El
     * WalletService valida que la version leída coincida con la actual
     * antes de aplicar cambios — sino tira `WalletConcurrencyError`.
     */
    version: integer('version').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Constraint: balance no puede ser negativo. Cualquier UPDATE que lo
    // intente cae con error a nivel DB, antes de aplicarse.
    check('wallets_balance_nonneg', sql`${table.balance} >= 0`),
    check('wallets_locked_balance_nonneg', sql`${table.lockedBalance} >= 0`),
    // Una wallet por user.
    uniqueIndex('wallets_user_id_unique').on(table.userId),
  ],
);

export type Wallet = typeof wallets.$inferSelect;
export type NewWallet = typeof wallets.$inferInsert;
