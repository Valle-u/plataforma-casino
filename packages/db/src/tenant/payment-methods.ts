/**
 * Tabla `payment_methods` (DB de tenant).
 *
 * Métodos de pago configurables por cada tenant. NO hay catálogo global
 * — cada operador define qué métodos acepta (transferencia bancaria
 * Argentina, USDT cripto, etc.).
 *
 * Ver `docs/04 §3 payment_methods`.
 *
 * `config` jsonb contiene datos del método específico:
 *   - bank_transfer: { cbu, alias, beneficiario, banco }
 *   - crypto: { network: 'TRC20', address, memo? }
 *   - other: cualquier shape
 *
 * `code` único por tenant. Permite referenciar el método desde deposits/
 * withdrawals sin acoplarse al display name.
 */

import { boolean, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { generateUuidV7 } from '../utils/uuid';
import { users } from './users';

export const paymentMethodTypeEnum = pgEnum('payment_method_type', [
  'bank_transfer',
  'crypto',
  'other',
]);

export const paymentMethods = pgTable(
  'payment_methods',
  {
    id: uuid('id').primaryKey().$defaultFn(generateUuidV7),

    /** Código único per-tenant (owner_id IS NULL) o per-owner (owner_id NOT NULL). */
    code: text('code').notNull(),

    /** Nombre legible para mostrar al user. */
    name: text('name').notNull(),

    type: paymentMethodTypeEnum('type').notNull(),

    /**
     * NULL = método del tenant (visible para todos los players).
     * NOT NULL = método de un nodo independiente (socio/distribuidor/cajero).
     */
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }),

    /** Config del método (CBU, address, etc.). */
    config: jsonb('config').notNull().default({}),

    /**
     * Parte B (tesorería): fichas por unidad de la moneda del método. Define
     * cuántas fichas se EMITEN por unidad de plata en un depósito y cuántas se
     * REDIMEN en un retiro. Ej: ARS → 1 (1 peso = 1 ficha); USDT → 1000.
     * Moneda base del MVP: 1 ficha = 1 peso. Ver docs/16-tesoreria.md §4-5.
     */
    chipsPerUnit: numeric('chips_per_unit', { precision: 14, scale: 4 })
      .notNull()
      .default('1'),

    isActive: boolean('is_active').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('payment_methods_code_unique')
      .on(table.code)
      .where(sql`${table.ownerId} IS NULL`),
    uniqueIndex('payment_methods_owner_code_unique')
      .on(table.ownerId, table.code)
      .where(sql`${table.ownerId} IS NOT NULL`),
  ],
);

export type PaymentMethod = typeof paymentMethods.$inferSelect;
export type NewPaymentMethod = typeof paymentMethods.$inferInsert;
