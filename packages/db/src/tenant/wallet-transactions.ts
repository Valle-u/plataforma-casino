/**
 * Tabla `wallet_transactions` (DB de tenant).
 *
 * Registro APPEND-ONLY de toda operación sobre wallets. Es la única fuente
 * autorizada para auditar dinero en el sistema. Ver `docs/04 §3 wallet`
 * y `docs/05-flujos-fichas.md §1`.
 *
 * Reglas duras:
 *   - **Nunca UPDATE ni DELETE**. Para revertir una tx se INSERTA una nueva
 *     con `type='rollback'` y `relatedTxId` apuntando a la original.
 *   - **`amount` siempre positivo**. La dirección la dicta el `type`:
 *       * "salidas" (`burn`, `unload`, `transfer_out`, `bet`, `withdrawal`,
 *          `bonus_forfeit`): el wallet pierde `amount`.
 *       * "entradas" (`mint`, `load`, `transfer_in`, `win`, `deposit`,
 *          `adjustment_credit`, `bonus_grant`, `bonus_clear`, etc.): el
 *          wallet gana `amount`.
 *       * `adjustment`: el signo de la operación lo decide el contexto;
 *          el monto sigue siendo positivo.
 *       * `rollback`: invierte la tx referenciada.
 *   - **`balance_after`** se guarda como snapshot al momento de la tx para
 *     auditoría rápida sin recomputar.
 *   - **`idempotency_key` UNIQUE**: dos requests con misma key deben referir
 *     a la misma tx exactamente. El UNIQUE garantiza que la DB rechaza el
 *     segundo intento aunque la aplicación tenga un bug.
 *   - **`related_tx_id`** linkea pares (transfer_out ↔ transfer_in, mint ↔
 *     bonus_grant, etc.) o rollbacks con su origen.
 *
 * Particionado mensual: pendiente. Para volúmenes esperados de MVP (<= 1M
 * filas por tenant) una tabla plana con índices alcanza. Cuando crezca,
 * `PARTITION BY RANGE (created_at)` + jobs de creación. Documentado.
 */

import {
  check,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { generateUuidV7 } from '../utils/uuid';
import { users } from './users';
import { wallets } from './wallets';

/**
 * Catálogo de tipos. Si querés sumar uno nuevo, agregalo acá y hacé el
 * `db:gen:tenant` para generar la migration de ALTER TYPE.
 *
 * Documentación de cada uno: `docs/05 §2` y comentarios inline.
 */
export const walletTxTypeEnum = pgEnum('wallet_tx_type', [
  'mint',
  'burn',
  'load',
  'unload',
  'transfer_in',
  'transfer_out',
  'bet',
  'win',
  'rollback',
  'adjustment',
  'bonus_grant',
  'bonus_clear',
  'bonus_forfeit',
  /**
   * `bonus_funding`: salida desde el wallet del FUNDER cuando se otorga
   * un bono. Diferencia con `bonus_grant` (que es entrada al wallet del
   * user) — son las dos caras de la misma operación. El admin_tenant
   * tiene un caso especial: como puede mintear, su `bonus_funding` se
   * acepta aunque el balance fuese 0 (el service lo hace minteando primero
   * — para MVP se debita normal porque el admin ya tiene mintazo previo).
   */
  'bonus_funding',
  /**
   * `bonus_funding_revert`: entrada al wallet del FUNDER cuando un bono
   * se cancela antes de ser usado. Reversa de `bonus_funding`.
   */
  'bonus_funding_revert',
  'deposit',
  'withdrawal',
  'jackpot_win',
  'promo_reward',
  'league_reward',
  'commission_payout',
  'fund_reserve',
  'fund_release',
  /**
   * `bonus_credit`: entrada al `bonus_balance` del wallet (concesión de
   * bono al jugador). Diferencia con `bonus_grant` que opera sobre el
   * `balance` normal.
   */
  'bonus_credit',
  /**
   * `bonus_debit`: salida del `bonus_balance` del wallet (consumo de
   * bono vía apuesta). El bet consume bonus primero, luego balance real.
   */
  'bonus_debit',
]);

export const walletTransactions = pgTable(
  'wallet_transactions',
  {
    id: uuid('id').primaryKey().$defaultFn(generateUuidV7),

    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id),

    type: walletTxTypeEnum('type').notNull(),

    /** Siempre > 0. La dirección viene del `type`. */
    amount: numeric('amount', { precision: 20, scale: 2 }).notNull(),

    /** Balance del wallet DESPUÉS de aplicar esta tx (snapshot). */
    balanceAfter: numeric('balance_after', { precision: 20, scale: 2 }).notNull(),

    /** Bonus balance del wallet DESPUÉS de aplicar esta tx (snapshot). */
    bonusBalanceAfter: numeric('bonus_balance_after', { precision: 20, scale: 2 })
      .notNull()
      .default('0'),

    /**
     * Para pares (transfer_out ↔ transfer_in) o rollbacks ↔ tx original.
     * NULL para tx solitarias (mint, burn, adjustment puro, bet sin par
     * estricto en este lado, etc.).
     */
    relatedTxId: uuid('related_tx_id'),

    /** Contraparte humana si aplica (ej. en load: el cajero). */
    counterpartyUserId: uuid('counterparty_user_id'),

    /**
     * Origen libre: 'cashier_panel', 'deposit_flow',
     * 'game_provider:pragmatic', 'admin_mint', etc.
     */
    source: text('source'),

    /**
     * ID de la entidad que originó: deposit_id, game_round_id, bonus_id,
     * promo_id, etc. Sirve para joins de reporting.
     */
    referenceId: uuid('reference_id'),

    /**
     * Clave de idempotencia del request HTTP que produjo esta tx.
     * UNIQUE → la DB rechaza duplicados aún si la app tiene un bug.
     */
    idempotencyKey: text('idempotency_key'),

    /** Actor humano que ejecutó la operación. NULL para tx de sistema. */
    createdBy: uuid('created_by').references(() => users.id),

    /** Motivo obligatorio para mint/burn/adjustment/unload. */
    reason: text('reason'),

    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check('wallet_tx_amount_positive', sql`${table.amount} > 0`),
    check('wallet_tx_balance_after_nonneg', sql`${table.balanceAfter} >= 0`),
    uniqueIndex('wallet_tx_idempotency_key_unique').on(table.idempotencyKey),
    index('wallet_tx_wallet_created').on(table.walletId, table.createdAt),
    index('wallet_tx_type_created').on(table.type, table.createdAt),
  ],
);

export type WalletTransaction = typeof walletTransactions.$inferSelect;
export type NewWalletTransaction = typeof walletTransactions.$inferInsert;
