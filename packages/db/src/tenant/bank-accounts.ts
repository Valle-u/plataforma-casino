/**
 * Tabla `bank_accounts` (DB de tenant) — las cuentas bancarias PROPIAS.
 *
 * Por qué existe: al cargar una transferencia, el titular y el banco de
 * nuestra cuenta se escribían a mano en dos cajas de texto libre. Nada impedía
 * poner ahí un tercero, y es lo que pasó — en producción quedó una entrante con
 * `account_holder = 'Juan Pérez'`, que en las otras seis filas es el
 * `sender_name` (el que envía). El mismo nombre figuraba una vez como titular
 * nuestro y seis como contraparte.
 *
 * Tampoco había forma de saber cuáles son nuestras cuentas: el concepto no
 * existía en ningún lado, ni tabla ni setting.
 *
 * Ahora se definen una vez y se eligen al cargar. Ver migración 0108.
 */

import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { generateUuidV7 } from '../utils/uuid';
import { users } from './users';

export const bankAccounts = pgTable(
  'bank_accounts',
  {
    id: uuid('id').primaryKey().$defaultFn(generateUuidV7),

    /**
     * Nombre corto para reconocerla en el selector ("Mercado Pago principal").
     * Es lo que ve el operador al cargar; el titular y el banco son el dato
     * que termina copiado en la transferencia.
     */
    label: text('label').notNull(),

    /** Titular de la cuenta. Se copia a `bank_transactions.account_holder`. */
    accountHolder: text('account_holder').notNull(),

    /** Banco de la cuenta. Se copia a `bank_transactions.bank_name`. */
    bankName: text('bank_name').notNull(),

    /**
     * CBU / alias / código interno. Opcional: sirve para distinguir dos cuentas
     * del mismo banco, y a futuro para autocompletar
     * `bank_transactions.bank_account`, que hoy está vacío en TODAS las filas.
     */
    accountIdentifier: text('account_identifier'),

    /**
     * Baja lógica. Nunca DELETE: las transferencias viejas apuntan a la cuenta
     * con la que se operaron, y borrarla dejaría huérfano un dato de auditoría
     * de plata real. Una cuenta inactiva no se ofrece al cargar, pero las
     * transferencias que la usaron la siguen mostrando.
     */
    isActive: boolean('is_active').notNull().default(true),

    createdBy: uuid('created_by').references(() => users.id),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // El selector pide las activas ordenadas por label.
    index('bank_accounts_active_idx').on(table.label).where(sql`${table.isActive}`),
    // Dos cuentas no pueden compartir titular + banco + identificador: serían
    // indistinguibles en el selector y se elegiría cualquiera. Parcial sobre
    // las activas — una dada de baja puede repetirse si se recrea.
    uniqueIndex('bank_accounts_unique_active')
      .on(
        sql`lower(trim(${table.accountHolder}))`,
        sql`lower(trim(${table.bankName}))`,
        sql`lower(trim(coalesce(${table.accountIdentifier}, '')))`,
      )
      .where(sql`${table.isActive}`),
  ],
);

export type BankAccount = typeof bankAccounts.$inferSelect;
export type NewBankAccount = typeof bankAccounts.$inferInsert;
