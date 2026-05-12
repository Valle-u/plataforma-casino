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

import { boolean, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '../utils/uuid';

export const paymentMethodTypeEnum = pgEnum('payment_method_type', [
  'bank_transfer',
  'crypto',
  'other',
]);

export const paymentMethods = pgTable(
  'payment_methods',
  {
    id: uuid('id').primaryKey().$defaultFn(generateUuidV7),

    /** Código único per-tenant. Ej: 'arg_brubank', 'usdt_trc20'. */
    code: text('code').notNull(),

    /** Nombre legible para mostrar al user. */
    name: text('name').notNull(),

    type: paymentMethodTypeEnum('type').notNull(),

    /** Config del método (CBU, address, etc.). */
    config: jsonb('config').notNull().default({}),

    isActive: boolean('is_active').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex('payment_methods_code_unique').on(table.code)],
);

export type PaymentMethod = typeof paymentMethods.$inferSelect;
export type NewPaymentMethod = typeof paymentMethods.$inferInsert;
