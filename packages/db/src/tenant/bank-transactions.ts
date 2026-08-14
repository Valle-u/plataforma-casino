/**
 * Tabla `bank_transactions` (DB de tenant) — Sprint 50.
 *
 * Separación de funciones: el empleado de confianza del tenant lee el
 * extracto bancario real y carga acá cada transferencia entrante. El
 * cajero NO tiene acceso al banco — solo ve esta tabla y matchea cada
 * `deposit` pending con una bank_transaction sin matchear.
 *
 * Reglas:
 *   - Append-only en condiciones normales. DELETE solo admin (audit).
 *   - UPDATE permitido para campos de matching (status, matched_*, notes).
 *   - 1 bank_transaction matchea con 0 o 1 deposit (relación 1:0..1).
 *   - El monto de la bank_tx DEBE coincidir con `deposits.amountFiat`
 *     para match automático. Override (admin/cajero con notes) permite
 *     match con monto distinto (caso: comisión bancaria, monto redondeado).
 *
 * Por qué no FK en una dirección sola:
 *   - `bank_transactions.matched_deposit_id` está acá para ver "esta tx
 *     respaldó qué deposit".
 *   - `deposits.bank_transaction_id` se agrega en una migration aparte
 *     para query rápido "este deposit fue respaldado por qué transferencia".
 *   - Ambos NULL hasta el match. Atomicidad la garantiza el service.
 */

import {
  check,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { generateUuidV7 } from '../utils/uuid';
import { deposits } from './deposits';
import { users } from './users';

/**
 * Status de la bank_transaction:
 *   - unmatched: subida pero sin asociar a deposit/withdrawal.
 *   - matched:   asociada a un deposit aprobado o withdrawal paid.
 *   - disputed:  el admin marcó que algo no cierra (audit). No bloquea.
 */
export const bankTransactionStatusEnum = pgEnum('bank_transaction_status', [
  'unmatched',
  'matched',
  'disputed',
]);

/**
 * Sprint 51: dirección de la transferencia.
 *   - incoming: cliente → banco del tenant (respalda un deposit).
 *   - outgoing: banco del tenant → cliente (respalda un withdrawal).
 *
 * El empleado de confianza sube AMBOS tipos (separación de funciones
 * simétrica entre carga y retiro). El cajero nunca toca plata física.
 */
export const bankTransactionDirectionEnum = pgEnum('bank_transaction_direction', [
  'incoming',
  'outgoing',
]);

export const bankTransactions = pgTable(
  'bank_transactions',
  {
    id: uuid('id').primaryKey().$defaultFn(generateUuidV7),

    /**
     * Identificador del banco/cuenta donde llegó. Texto libre — puede
     * ser CBU, alias, código interno del tenant. Permite filtrar por
     * cuenta cuando el tenant tiene varios bancos.
     *
     * Sprint 53 (decisión dueño): NULL permitido — el comprobante es la
     * única prueba obligatoria para transferencias salientes (el CBU de
     * origen ya no se exige en el pago completo). Para entrantes sigue
     * usándose como matcher del deposit.
     */
    bankAccount: text('bank_account'),

    /** Monto efectivamente acreditado en el banco. */
    amount: numeric('amount', { precision: 20, scale: 2 }).notNull(),

    /** Moneda — default ARS pero el tenant puede operar en USDT, USD, etc. */
    currency: text('currency').notNull().default('ARS'),

    /**
     * Sprint 54: titular de la cuenta propia del tenant con la que se hizo
     * la transferencia (entrante: la que recibe; saliente: con la que
     * enviamos). Se muestra en el listado y queda como dato de auditoría.
     */
    accountHolder: text('account_holder'),

    /** Sprint 54: nombre del banco de la cuenta propia usada. */
    bankName: text('bank_name'),

    /** Nombre del remitente según el extracto. */
    senderName: text('sender_name'),

    /** CBU/alias del remitente si el banco lo expone. */
    senderCbu: text('sender_cbu'),

    /** Mensaje/concepto que el remitente puso. */
    reference: text('reference'),

    /**
     * Comprobante de pago (Sprint 52): URL del archivo subido. Para R2 con
     * bucket privado es signed URL con TTL; para local es URL estable.
     * OBLIGATORIO a nivel app para direction='outgoing' (el DTO/service lo
     * enforce). Nullable a nivel DB por transferencias legacy.
     */
    receiptUrl: text('receipt_url'),

    /**
     * Sprint 52: storage key opaco que devolvió `StorageService.upload`.
     * Lo usamos para regenerar signed URLs cuando expiran y para borrar el
     * archivo si se desmatchea/borra la transferencia. También es el TOKEN
     * de dedupe: el mismo comprobante no puede cargarse dos veces (sustituye
     * al bankReference eliminado por decisión del dueño).
     */
    receiptStorageKey: text('receipt_storage_key'),

    /**
     * Sprint 55: SHA-256 del CONTENIDO del comprobante (no del storage key,
     * que es un UUID random por upload). Es el token de dedupe real: el MISMO
     * archivo no puede respaldar dos transferencias (depósitos y pagos).
     * Lo calcula el server en `/upload-proof` y el cliente lo devuelve en el
     * create/update. El índice único parcial es el backstop a nivel DB.
     */
    receiptHash: text('receipt_hash'),

    /** Cuándo llegó la plata al banco (timestamp del extracto). */
    receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' })
      .notNull(),

    status: bankTransactionStatusEnum('status').notNull().default('unmatched'),

    /**
     * Sprint 51: dirección de la transferencia.
     * - 'incoming': cliente transfirió al banco del tenant (respalda deposit).
     * - 'outgoing': tenant transfirió al cliente (respalda withdrawal).
     */
    direction: bankTransactionDirectionEnum('direction').notNull().default('incoming'),

    /** Empleado que cargó la tx al sistema. */
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),

    /** Deposit asociado tras match (solo para direction='incoming'). NULL hasta entonces. */
    matchedDepositId: uuid('matched_deposit_id').references(() => deposits.id),

    /**
     * Sprint 51: Withdrawal asociado tras match (solo para
     * direction='outgoing'). NULL hasta entonces. NO FK aquí — usamos
     * UUID raw porque la tabla `withdrawals` se evalúa después de
     * bank_transactions y crearía ciclo. La integridad la chequea el
     * service en el match endpoint.
     */
    matchedWithdrawalId: uuid('matched_withdrawal_id'),

    /**
     * B-build-3 (tesorería): aporte de capital del dueño asociado tras match
     * (solo direction='incoming' — la plata del dueño a la caja). NULL hasta el
     * match. Raw uuid (sin FK): `house_capital_injections` se evalúa después y
     * crearía ciclo; la integridad la chequea el HouseService.
     */
    matchedCapitalInjectionId: uuid('matched_capital_injection_id'),

    /**
     * Carga/retiro de fichas MANUAL asociado tras match. Apunta al
     * wallet_transaction (type 'load' para direction='incoming', 'unload' para
     * 'outgoing'). Raw uuid (sin FK): wallet_transactions es append-only y la
     * integridad la chequea BankTransactionsService en el match. NULL hasta el match.
     */
    matchedManualTxId: uuid('matched_manual_tx_id'),

    /** Quién matcheó (cajero/admin) y cuándo. NULL hasta el match. */
    matchedBy: uuid('matched_by').references(() => users.id),
    matchedAt: timestamp('matched_at', { withTimezone: true, mode: 'date' }),

    /**
     * Si el match fue override (monto distinto al deposit), el cajero
     * DEBE escribir motivo acá. Audit severity:high en ese caso.
     */
    overrideReason: text('override_reason'),

    /** Notas libres del empleado/cajero. */
    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check('bank_tx_amount_positive', sql`${table.amount} > 0`),
    // Hot path: empleado busca "qué subí hoy".
    index('bank_tx_uploaded_by_uploaded').on(table.uploadedBy, table.uploadedAt),
    // Hot path: cajero busca unmatched por monto exacto.
    index('bank_tx_status_amount').on(table.status, table.amount),
    // Hot path: lookup por deposit matcheado.
    index('bank_tx_matched_deposit').on(table.matchedDepositId),
    // Dedupe por comprobante (decisión dueño, Sprint 52): el mismo archivo
    // no puede respaldar dos transferencias. Sustituye al viejo dedupe por
    // (bankAccount, bankReference), campo eliminado. NULL permitido para
    // transferencias legacy sin comprobante.
    uniqueIndex('bank_tx_receipt_key_unique')
      .on(table.receiptStorageKey)
      .where(sql`${table.receiptStorageKey} IS NOT NULL`),
    // Sprint 55: dedupe por contenido del comprobante. El MISMO archivo no
    // puede respaldar dos transferencias (el storage key es random por
    // upload y no alcanzaba). NULL permitido para transferencias legacy.
    uniqueIndex('bank_tx_receipt_hash_unique')
      .on(table.receiptHash)
      .where(sql`${table.receiptHash} IS NOT NULL`),
  ],
);

export type BankTransaction = typeof bankTransactions.$inferSelect;
export type NewBankTransaction = typeof bankTransactions.$inferInsert;
