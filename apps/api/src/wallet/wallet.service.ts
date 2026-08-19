/**
 * WalletService — única vía autorizada para mutar `wallets.balance`.
 *
 * Diseño:
 *   - **Toda mutación dentro de TX Postgres** (`db.transaction(...)`).
 *   - **SELECT FOR UPDATE** sobre la fila de wallet → bloquea concurrencia.
 *   - **INSERT en `wallet_transactions` + UPDATE en `wallets`** dentro de
 *     la misma TX. Si una falla, la otra se rollbackea. Atómico.
 *   - **Optimistic locking** complementario: leemos `version`, validamos
 *     antes del update, incrementamos. Cubre el caso donde otra TX ya
 *     había committed entre nuestro SELECT y nuestro UPDATE en patrones
 *     que no usen FOR UPDATE (defensa en profundidad).
 *
 * Los handlers (controller) llaman a métodos públicos como `mint()`,
 * `burn()`, etc. — el helper privado `executeTransaction()` concentra
 * el patrón TX + INSERT + UPDATE para que cada operación pública sea
 * solo política (qué tipo, qué validaciones de dominio) y no plomería.
 *
 * Idempotencia:
 *   - Validamos `idempotencyKey` UNIQUE en `wallet_transactions`. Si el
 *     INSERT cae con código 23505 (unique_violation), devolvemos la tx
 *     existente como si fuera la primera (idempotente).
 *   - El interceptor de idempotency_keys hace cache de response a nivel
 *     HTTP además de esto (defensa doble).
 */

import { Injectable } from '@nestjs/common';
import { and, eq, getTableColumns, inArray, notInArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  generateUuidV7,
  HOUSE_USERNAME,
  roles,
  userRoles,
  users,
  walletHolds,
  wallets,
  walletTransactions,
  type NewWalletHold,
  type NewWalletTransaction,
  type Wallet,
  type WalletHold,
  type WalletTransaction,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { isUniqueViolation } from '../common/pg-error';
import {
  IdempotencyConflictError,
  IndependentBranchTargetError,
  InsufficientBalanceError,
  IssuerInsufficientBalanceError,
  MintRoleRequiredError,
  SelfTransferError,
  TargetUserNotFoundError,
  WalletConcurrencyError,
  WalletNotFoundError,
} from './wallet.errors';

export type WalletTxType = WalletTransaction['type'];

/** Operaciones que SUMAN al balance del wallet. */
const CREDIT_TYPES = new Set<WalletTxType>([
  'mint',
  'load',
  'transfer_in',
  'win',
  'deposit',
  'bonus_grant',
  'bonus_clear',
  'bonus_funding_revert',
  'jackpot_win',
  'promo_reward',
  'league_reward',
  'commission_payout',
  'fund_release',
]);

/** Operaciones que RESTAN del balance del wallet. */
const DEBIT_TYPES = new Set<WalletTxType>([
  'burn',
  'unload',
  'transfer_out',
  'bet',
  'withdrawal',
  'bonus_forfeit',
  'bonus_funding',
  'fund_reserve',
]);

/** Operaciones que afectan bonus_balance (no balance principal). */
const BONUS_BALANCE_CREDIT_TYPES = new Set<WalletTxType>(['bonus_credit']);
const BONUS_BALANCE_DEBIT_TYPES = new Set<WalletTxType>(['bonus_debit']);

interface ExecuteTxParams {
  walletId: string;
  type: WalletTxType;
  amount: string; // numeric(20,2) como string siempre.
  source?: string | null;
  referenceId?: string | null;
  relatedTxId?: string | null;
  counterpartyUserId?: string | null;
  idempotencyKey?: string | null;
  createdBy?: string | null;
  reason?: string | null;
  notes?: string | null;
}

interface MintOrBurnParams {
  actorUserId: string;
  amount: string;
  reason: string;
  idempotencyKey: string;
  referenceId?: string | null;
  notes?: string | null;
}

export interface TransferPairResult {
  /** Tx con type='transfer_out' (o equivalente debit) sobre el source. */
  sourceTx: WalletTransaction;
  /** Tx con type='transfer_in' (o equivalente credit) sobre el target. */
  targetTx: WalletTransaction;
  /** Estado final de los dos wallets tras la operación. */
  sourceWallet: Wallet;
  targetWallet: Wallet;
}

interface TransferPairParams {
  actorUserId: string;
  /** ID del user dueño del wallet ORIGEN (el que pierde fichas). */
  sourceUserId: string;
  /** ID del user dueño del wallet DESTINO (el que recibe fichas). */
  targetUserId: string;
  amount: string;
  /** Tipo en el lado source: 'transfer_out' por default; 'unload' lo pisa con 'unload'. */
  sourceType: 'transfer_out' | 'unload';
  /** Tipo en el lado target: 'transfer_in' por default; 'load' lo pisa con 'load';
   *  'commission_payout' para el flujo de revenue share (Sprint 25);
   *  'adjustment' para cargas por corrección/bonificación/reintegro del empleado (docs/19);
   *  'deposit' para el flujo de carga aprobada por el cajero (F2: transfer doble
   *  entrada desde el issuer resuelto por HouseService);
   *  'bonus_grant' para el VIP deposit bonus (transfer del issuer al player). */
  targetType:
    | 'transfer_in'
    | 'load'
    | 'commission_payout'
    | 'adjustment'
    | 'deposit'
    | 'bonus_grant';
  /** Source operativo: 'load_flow', 'unload_flow', 'commission_payout', etc. */
  source: string;
  idempotencyKey: string;
  reason?: string | null;
  notes?: string | null;
  referenceId?: string | null;
}

/**
 * Fila de wallet_transaction enriquecida para el CSV: agrega los usernames
 * resueltos (dueño de la wallet, contraparte, actor) además de los UUIDs.
 */
export interface WalletTxExportRow extends WalletTransaction {
  ownerUsername: string | null;
  counterpartyUsername: string | null;
  createdByUsername: string | null;
}

@Injectable()
export class WalletService {
  /**
   * Devuelve el wallet del user. Si no existe, lo crea con balance 0.
   * Idempotente (segura concurrencia: el UNIQUE en user_id atrapa la
   * race; reintenta el SELECT).
   */
  async getOrCreateWalletForUser(db: TenantDb, userId: string): Promise<Wallet> {
    const existing = await db.select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
    if (existing[0]) return existing[0];

    try {
      const inserted = await db
        .insert(wallets)
        .values({ userId })
        .returning();
      return inserted[0]!;
    } catch (err: unknown) {
      // 23505 = unique_violation: otro request creó la wallet en el medio.
      // Re-leer y devolver.
      if (isUniqueViolation(err)) {
        const reread = await db
          .select()
          .from(wallets)
          .where(eq(wallets.userId, userId))
          .limit(1);
        if (reread[0]) return reread[0];
      }
      throw err;
    }
  }

  /**
   * Lista las wallet transactions del wallet de un user (history).
   * Ordenado por createdAt DESC, paginado con offset.
   *
   * `excludeTypes` (optativo) filtra fuera de la lista los `type` indicados.
   * Se usa para que la pantalla de movimientos del player solo muestre
   * cargas/retiros/bonos y no apuestas/ganancias de juego — ver
   * `apps/web/app/play/wallet/page.tsx`.
   */
  async listTransactionsForUser(
    db: TenantDb,
    userId: string,
    limit = 50,
    offset = 0,
    excludeTypes: WalletTxType[] = [],
  ): Promise<{ data: WalletTransaction[]; total: number }> {
    const wallet = await this.getOrCreateWalletForUser(db, userId);
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const safeOffset = Math.max(offset, 0);
    const where = and(
      eq(walletTransactions.walletId, wallet.id),
      excludeTypes.length > 0
        ? notInArray(walletTransactions.type, excludeTypes)
        : undefined,
    );
    const data = await db
      .select()
      .from(walletTransactions)
      .where(where)
      .orderBy(sql`${walletTransactions.createdAt} DESC, ${walletTransactions.id} DESC`)
      .limit(safeLimit)
      .offset(safeOffset);
    const totalRows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(walletTransactions)
      .where(where);
    return { data, total: totalRows[0]?.n ?? 0 };
  }

  /**
   * Variante para export CSV: levanta el cap (configurable) y devuelve
   * todas las rows del wallet del user. Cap default 50k — el `WalletController`
   * de export pasa `CSV_EXPORT_MAX_ROWS`.
   *
   * No reusamos `listTransactionsForUser` para evitar exponer un cap
   * arbitrario al endpoint normal del panel (que sí debe quedar capped en 200).
   */
  async listTransactionsForExport(
    db: TenantDb,
    userId: string,
    maxLimit: number,
  ): Promise<{ data: WalletTxExportRow[]; total: number }> {
    const wallet = await this.getOrCreateWalletForUser(db, userId);
    const safeLimit = Math.max(maxLimit, 1);

    // Legibilidad (2026-08-14): el CSV traía wallet_id/counterparty_user_id/
    // created_by como UUID crudo. Resolvemos a username: el dueño (userId) una
    // vez, y contraparte/actor con self-joins a users.
    const owner = await db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const ownerUsername = owner[0]?.username ?? null;

    const cp = alias(users, 'cp_user');
    const cb = alias(users, 'cb_user');
    const rows = await db
      .select({
        ...getTableColumns(walletTransactions),
        counterpartyUsername: cp.username,
        createdByUsername: cb.username,
      })
      .from(walletTransactions)
      .leftJoin(cp, eq(cp.id, walletTransactions.counterpartyUserId))
      .leftJoin(cb, eq(cb.id, walletTransactions.createdBy))
      .where(eq(walletTransactions.walletId, wallet.id))
      .orderBy(sql`${walletTransactions.createdAt} DESC, ${walletTransactions.id} DESC`)
      .limit(safeLimit);
    const data: WalletTxExportRow[] = rows.map((r) => ({ ...r, ownerUsername }));

    const totalRows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(walletTransactions)
      .where(eq(walletTransactions.walletId, wallet.id));
    return { data, total: totalRows[0]?.n ?? 0 };
  }

  /** Lee el wallet del user (no lo crea). Tira `WalletNotFoundError`. */
  async getByUserId(db: TenantDb, userId: string): Promise<Wallet> {
    const rows = await db.select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
    if (!rows[0]) throw new WalletNotFoundError(userId);
    return rows[0];
  }

  /**
   * Burn: destruye fichas del wallet del admin actor.
   *
   * (El mint directo del admin se eliminó — las fichas solo se crean vía
   * `mintToWallet` desde el aporte de capital a la Casa. Ver B-build-6.)
   * Falla con `InsufficientBalanceError` si el wallet del admin no tiene
   * suficiente saldo.
   */
  async burn(db: TenantDb, params: MintOrBurnParams): Promise<WalletTransaction> {
    await this.assertAdminTenant(db, params.actorUserId);
    const wallet = await this.getOrCreateWalletForUser(db, params.actorUserId);
    return this.executeTransaction(db, {
      walletId: wallet.id,
      type: 'burn',
      amount: params.amount,
      source: 'admin_burn',
      referenceId: params.referenceId ?? null,
      idempotencyKey: params.idempotencyKey,
      createdBy: params.actorUserId,
      reason: params.reason,
      notes: params.notes ?? null,
    });
  }

  /**
   * Quema fichas de un wallet ESPECÍFICO (a diferencia de `burn`, que quema el
   * wallet del actor). Solo `admin_tenant`. Burn puro → el supply baja; se cuenta
   * en `totalBurned` de la reconciliación (que agrega por `type='burn'`, no por
   * source). Idempotente por `idempotencyKey`.
   *
   * Uso: el flip indep→dep destruye el stock propio sin vender del socio ("se
   * quema sin reintegro", docs/17 §14.3). El `source` distingue el motivo.
   */
  async burnFromWallet(
    db: TenantDb,
    params: {
      userId: string;
      amount: string;
      source?: string;
      referenceId?: string | null;
      idempotencyKey: string;
      actorUserId: string;
      reason: string;
      notes?: string | null;
    },
  ): Promise<WalletTransaction> {
    await this.assertAdminTenant(db, params.actorUserId);
    const wallet = await this.getOrCreateWalletForUser(db, params.userId);
    return this.executeTransaction(db, {
      walletId: wallet.id,
      type: 'burn',
      amount: params.amount,
      source: params.source ?? 'admin_burn',
      referenceId: params.referenceId ?? null,
      idempotencyKey: params.idempotencyKey,
      createdBy: params.actorUserId,
      reason: params.reason,
      notes: params.notes ?? null,
    });
  }

  /**
   * Load: el actor TRANSFIERE fichas HACIA el wallet de targetUserId.
   *
   * Si el actor es admin_tenant, las fichas salen de la wallet de la Casa
   * (__casa__), no de la wallet del admin (E3 — la Casa es la única fuente).
   * Si el actor es socio/distribuidor/cajero INDEPENDIENTE, las fichas salen
   * de su propio wallet (su stock).
   *
   * Validaciones:
   *   - target debe existir en la tabla `users` (sino TargetUserNotFoundError).
   *   - source !== target (sino SelfTransferError).
   *   - source debe tener saldo suficiente (sino InsufficientBalanceError).
   *
   * Auditoría doble: source recibe tx `transfer_out`, target recibe tx
   * `load`. Ambas linkeadas por `related_tx_id`.
   */
  async load(
    db: TenantDb,
    params: {
      actorUserId: string;
      targetUserId: string;
      amount: string;
      idempotencyKey: string;
      reason?: string | null;
      notes?: string | null;
    },
  ): Promise<TransferPairResult> {
    // E8/R4/P3: el stock de un socio independiente entra por venta
    // (branch_chip_sale), nunca por cargas manuales desde la red central.
    const targetRows = await db
      .select({ isIndependent: users.isIndependentBranch })
      .from(users)
      .where(eq(users.id, params.targetUserId))
      .limit(1);
    if (targetRows[0]?.isIndependent) {
      throw new IndependentBranchTargetError(params.targetUserId);
    }

    // E3: si el actor es admin_tenant, las fichas salen de la Casa.
    let sourceUserId = params.actorUserId;
    const isAdmin = await this.isUserAdmin(db, params.actorUserId);
    if (isAdmin) {
      const houseUser = await db
        .select()
        .from(users)
        .where(eq(users.username, HOUSE_USERNAME))
        .limit(1);
      if (houseUser[0]) {
        sourceUserId = houseUser[0].id;
      }
    }

    return this.executeTransferPair(db, {
      actorUserId: params.actorUserId,
      sourceUserId,
      targetUserId: params.targetUserId,
      amount: params.amount,
      sourceType: 'transfer_out',
      targetType: 'load',
      source: 'load_flow',
      idempotencyKey: params.idempotencyKey,
      reason: params.reason ?? null,
      notes: params.notes ?? null,
    });
  }

  /**
   * Unload: el actor RETIRA fichas DESDE el wallet del target HACIA SU wallet.
   * `reason` es obligatorio (regla del doc §4).
   *
   * Misma mecánica que load, pero invertido: target pierde, source (=actor)
   * gana. Las tx llevan types 'unload' (en el target) + 'transfer_in' (en
   * el actor).
   */
  async unload(
    db: TenantDb,
    params: {
      actorUserId: string;
      targetUserId: string;
      amount: string;
      reason: string;
      idempotencyKey: string;
      notes?: string | null;
    },
  ): Promise<TransferPairResult> {
    return this.executeTransferPair(db, {
      actorUserId: params.actorUserId,
      sourceUserId: params.targetUserId, // el target PIERDE.
      targetUserId: params.actorUserId, // el actor RECIBE.
      amount: params.amount,
      sourceType: 'unload',
      targetType: 'transfer_in',
      source: 'unload_flow',
      idempotencyKey: params.idempotencyKey,
      reason: params.reason,
      notes: params.notes ?? null,
    });
  }

  /**
   * Reserva fichas en un wallet (hold). Incrementa `locked_balance` y
   * mantiene `balance` igual — el monto reservado NO es gastable mientras
   * el hold esté activo, pero no se debita del balance hasta que se
   * concrete la operación (paid).
   *
   * Esto es lo que pasa al SOLICITAR un retiro: las fichas quedan
   * "comprometidas" para que el user no las apueste mientras se aprueba.
   *
   * Tira `InsufficientBalanceError` si balance disponible (balance -
   * locked_balance) < amount.
   */
  async placeHold(
    db: TenantDb,
    params: {
      userId: string;
      amount: string;
      reason: string;
      relatedEntityType?: string | null;
      relatedEntityId?: string | null;
    },
  ): Promise<WalletHold> {
    return db.transaction(async (tx) => {
      const wallet = await this.getOrCreateWalletForUser(
        tx as unknown as TenantDb,
        params.userId,
      );
      const lockedRows = await tx
        .select()
        .from(wallets)
        .where(eq(wallets.id, wallet.id))
        .for('update')
        .limit(1);
      const locked = lockedRows[0]!;

      const availableCents = this.toCents(locked.balance) - this.toCents(locked.lockedBalance);
      if (availableCents < this.toCents(params.amount)) {
        throw new InsufficientBalanceError(
          this.fromCents(availableCents),
          params.amount,
        );
      }

      const newLocked = this.computeBalanceAfter(locked.lockedBalance, params.amount, 'credit');
      await tx
        .update(wallets)
        .set({
          lockedBalance: newLocked,
          version: sql`${wallets.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(wallets.id, wallet.id), eq(wallets.version, locked.version)));

      const newHold: NewWalletHold = {
        id: generateUuidV7(),
        walletId: wallet.id,
        amount: params.amount,
        reason: params.reason,
        relatedEntityType: params.relatedEntityType ?? null,
        relatedEntityId: params.relatedEntityId ?? null,
      };
      const inserted = await tx.insert(walletHolds).values(newHold).returning();
      return inserted[0]!;
    });
  }

  /**
   * Libera un hold (lo marca released, restituye locked_balance al wallet).
   * No afecta `balance` — el monto vuelve a estar disponible.
   * Idempotente: si ya está released, no hace nada.
   */
  async releaseHold(db: TenantDb, holdId: string): Promise<void> {
    await db.transaction(async (tx) => {
      const lockedHoldRows = await tx
        .select()
        .from(walletHolds)
        .where(eq(walletHolds.id, holdId))
        .for('update')
        .limit(1);
      const hold = lockedHoldRows[0];
      if (!hold || hold.releasedAt) return; // idempotente.

      const walletRows = await tx
        .select()
        .from(wallets)
        .where(eq(wallets.id, hold.walletId))
        .for('update')
        .limit(1);
      const wallet = walletRows[0]!;

      const newLocked = this.computeBalanceAfter(wallet.lockedBalance, hold.amount, 'debit');
      await tx
        .update(wallets)
        .set({
          lockedBalance: newLocked,
          version: sql`${wallets.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(wallets.id, hold.walletId));

      await tx
        .update(walletHolds)
        .set({ releasedAt: new Date() })
        .where(eq(walletHolds.id, holdId));
    });
  }

  /**
   * Debita el monto del wallet Y libera el hold asociado, dentro de la
   * misma TX. Usado al marcar un retiro como `paid`: las fichas que
   * estaban en hold ahora se "queman" (salen del sistema).
   *
   * Genera una wallet tx `type='withdrawal'` con
   * `idempotencyKey='withdrawal:<id>'` — el UNIQUE en `wallet_transactions.idempotency_key`
   * enforce que dos llamadas concurrentes con el mismo withdrawalId resulten
   * en UNA sola tx. Además hacemos idempotency check post-lock: si la key ya
   * existe (retry post-commit), devolvemos la tx previa sin re-debitar.
   *
   * Post-F7: withdrawals volvieron a BURN puro — las fichas del player
   * desaparecen del sistema al pagarse. El "issuer" snapshotteado en el
   * withdrawal ya no recibe fichas: sigue siendo el banco que paga fiat
   * afuera del sistema, pero contablemente el retiro sale del ledger.
   */
  async debitWithHoldRelease(
    db: TenantDb,
    params: {
      holdId: string;
      withdrawalId: string;
      actorUserId: string;
    },
  ): Promise<WalletTransaction> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);

      // 1. Lock del hold.
      const holdRows = await tx
        .select()
        .from(walletHolds)
        .where(eq(walletHolds.id, params.holdId))
        .for('update')
        .limit(1);
      const hold = holdRows[0];
      if (!hold) {
        throw new Error(`Hold ${params.holdId} no existe.`);
      }

      const idempotencyKey = `withdrawal:${params.withdrawalId}`;

      // 2. Idempotency check post-lock: si ya fue committed por otra TX
      //    (retry post-commit), devolvemos la tx previa. Cubrimos el caso
      //    donde el hold quedó released por la primera llamada y evitamos
      //    tirar "hold ya liberado" en el retry legítimo.
      const existing = await tx
        .select()
        .from(walletTransactions)
        .where(eq(walletTransactions.idempotencyKey, idempotencyKey))
        .limit(1);
      if (existing[0]) {
        return existing[0];
      }

      if (hold.releasedAt) {
        // Hold released pero sin tx con nuestra idempotency key → inconsistencia.
        // (Ej.: hold liberado por reject / markFailed y ahora nos piden markPaid.)
        throw new Error(`Hold ${params.holdId} ya estaba liberado.`);
      }

      // 3. Lock del wallet.
      const walletRows = await tx
        .select()
        .from(wallets)
        .where(eq(wallets.id, hold.walletId))
        .for('update')
        .limit(1);
      const wallet = walletRows[0]!;

      const newBalance = this.computeBalanceAfter(wallet.balance, hold.amount, 'debit');
      if (this.toCents(newBalance) < 0n) {
        // No debería pasar — el hold garantiza fondos por construcción.
        // Defensa en profundidad.
        throw new InsufficientBalanceError(wallet.balance, hold.amount);
      }
      const newLocked = this.computeBalanceAfter(wallet.lockedBalance, hold.amount, 'debit');

      // 4. INSERT wallet tx withdrawal (burn puro: sin counterparty).
      const newTx: NewWalletTransaction = {
        id: generateUuidV7(),
        walletId: wallet.id,
        type: 'withdrawal',
        amount: hold.amount,
        balanceAfter: newBalance,
        source: 'withdrawal_flow',
        referenceId: params.withdrawalId,
        idempotencyKey,
        createdBy: params.actorUserId,
      };
      const inserted = await tx.insert(walletTransactions).values(newTx).returning();

      // 5. UPDATE wallet con optimistic-lock check.
      const updated = await tx
        .update(wallets)
        .set({
          balance: newBalance,
          lockedBalance: newLocked,
          version: sql`${wallets.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(wallets.id, wallet.id), eq(wallets.version, wallet.version)))
        .returning();
      if (updated.length === 0) {
        throw new WalletConcurrencyError(wallet.id);
      }

      // 6. Marcar hold como released.
      await tx
        .update(walletHolds)
        .set({ releasedAt: new Date() })
        .where(eq(walletHolds.id, params.holdId));

      return inserted[0]!;
    });
  }

  /**
   * Como `debitWithHoldRelease`, PERO en lugar de burn puro (destruir chips
   * del ledger), TRANSFIERE los chips del player al issuer (Casa o socio
   * indep). Es el modelo issuer-aware para withdrawals (F3): las chips no
   * salen del sistema — cambian de mano. Del lado banco/afuera la plata sí
   * sale, pero el ledger se mantiene equilibrado (1 ficha = 1 peso todavía
   * respaldado por el issuer que ahora tiene esas fichas).
   *
   * En una sola tx:
   *   1. FOR UPDATE sobre wallet_holds (bloquea el hold, valida no released).
   *   2. FOR UPDATE sobre las 2 wallets EN ORDEN ASC por id (anti-deadlock,
   *      mismo patrón que executeTransferPair).
   *   3. Idempotency check post-lock por `withdrawal:<id>` (lado source).
   *   4. Debita player (balance − amount, locked_balance − amount).
   *   5. Acredita issuer (balance + amount).
   *   6. INSERT tx source: type='withdrawal', source='withdrawal_flow',
   *      referenceId=withdrawalId, idempotencyKey='withdrawal:<id>',
   *      counterpartyUserId=issuerUserId.
   *   7. INSERT tx target: type='transfer_in', source='withdrawal_flow',
   *      referenceId=withdrawalId, sin idempotencyKey (unique lo impide),
   *      relatedTxId=sourceTxId, counterpartyUserId=playerUserId.
   *   8. Marca hold releasedAt.
   *
   * `issuerUserId=null` no llega acá — el caller resuelve el Casa userId
   * antes (por HouseService.getHouseUser) y pasa un userId concreto.
   */
  async debitWithHoldReleaseAndTransfer(
    db: TenantDb,
    params: {
      holdId: string;
      withdrawalId: string;
      playerWalletId: string;
      issuerWalletId: string;
      actorUserId: string;
      playerUserId: string;
      issuerUserId: string;
    },
  ): Promise<{ sourceTxId: string; targetTxId: string }> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);

      // 1. Lock del hold.
      const holdRows = await tx
        .select()
        .from(walletHolds)
        .where(eq(walletHolds.id, params.holdId))
        .for('update')
        .limit(1);
      const hold = holdRows[0];
      if (!hold) {
        throw new Error(`Hold ${params.holdId} no existe.`);
      }
      if (hold.releasedAt) {
        throw new Error(`Hold ${params.holdId} ya estaba liberado.`);
      }
      if (hold.walletId !== params.playerWalletId) {
        throw new Error(
          `Hold ${params.holdId} pertenece a wallet ${hold.walletId}, no a ${params.playerWalletId}.`,
        );
      }

      // 2. Lock de ambas wallets en orden ASC por id (anti-deadlock).
      //    IMPORTANTE: usar el query builder de drizzle en lugar de raw SQL,
      //    para que el mapper snake_case → camelCase funcione (locked_balance
      //    → lockedBalance). Con raw SQL las props llegan en snake_case y
      //    playerWallet.lockedBalance queda undefined → toCents() crashea.
      const idsAsc = [params.playerWalletId, params.issuerWalletId].sort();
      const rows = await tx
        .select()
        .from(wallets)
        .where(inArray(wallets.id, idsAsc))
        .orderBy(wallets.id)
        .for('update');
      const playerWallet = rows.find((w) => w.id === params.playerWalletId);
      const issuerWallet = rows.find((w) => w.id === params.issuerWalletId);
      if (!playerWallet) throw new WalletNotFoundError(params.playerWalletId);
      if (!issuerWallet) throw new WalletNotFoundError(params.issuerWalletId);

      const idempotencyKey = `withdrawal:${params.withdrawalId}`;

      // 3. Idempotency check post-lock: si la key ya fue usada, devolvemos
      //    el par existente.
      const existingPrimary = await tx
        .select()
        .from(walletTransactions)
        .where(eq(walletTransactions.idempotencyKey, idempotencyKey))
        .limit(1);
      if (existingPrimary[0]) {
        const prev = existingPrimary[0];
        const related = await tx
          .select()
          .from(walletTransactions)
          .where(eq(walletTransactions.relatedTxId, prev.id))
          .limit(1);
        if (!related[0]) {
          throw new Error(
            `Inconsistencia: tx ${prev.id} sin related (idempotencyKey=${idempotencyKey}).`,
          );
        }
        return { sourceTxId: prev.id, targetTxId: related[0].id };
      }

      // 4. Calcular balances finales.
      const playerBalanceAfter = this.computeBalanceAfter(
        playerWallet.balance,
        hold.amount,
        'debit',
      );
      if (this.toCents(playerBalanceAfter) < 0n) {
        // No debería pasar — el hold garantiza fondos por construcción.
        // Defensa en profundidad.
        throw new InsufficientBalanceError(playerWallet.balance, hold.amount);
      }
      const playerLockedAfter = this.computeBalanceAfter(
        playerWallet.lockedBalance,
        hold.amount,
        'debit',
      );
      const issuerBalanceAfter = this.computeBalanceAfter(
        issuerWallet.balance,
        hold.amount,
        'credit',
      );

      // 5. INSERT source tx (player, primary, lleva idempotencyKey).
      const sourceTxId = generateUuidV7();
      const newSourceTx: NewWalletTransaction = {
        id: sourceTxId,
        walletId: params.playerWalletId,
        type: 'withdrawal',
        amount: hold.amount,
        balanceAfter: playerBalanceAfter,
        counterpartyUserId: params.issuerUserId,
        source: 'withdrawal_flow',
        referenceId: params.withdrawalId,
        idempotencyKey,
        createdBy: params.actorUserId,
      };
      const sourceInserted = await tx
        .insert(walletTransactions)
        .values(newSourceTx)
        .returning();
      const sourceTx = sourceInserted[0]!;

      // 6. INSERT target tx (issuer, secondary, related_tx_id = sourceTxId).
      const targetTxId = generateUuidV7();
      const newTargetTx: NewWalletTransaction = {
        id: targetTxId,
        walletId: params.issuerWalletId,
        type: 'transfer_in',
        amount: hold.amount,
        balanceAfter: issuerBalanceAfter,
        relatedTxId: sourceTxId,
        counterpartyUserId: params.playerUserId,
        source: 'withdrawal_flow',
        referenceId: params.withdrawalId,
        createdBy: params.actorUserId,
      };
      const targetInserted = await tx
        .insert(walletTransactions)
        .values(newTargetTx)
        .returning();
      const targetTx = targetInserted[0]!;

      // 7. UPDATE player wallet (debit balance + locked_balance).
      const playerUpdated = await tx
        .update(wallets)
        .set({
          balance: playerBalanceAfter,
          lockedBalance: playerLockedAfter,
          version: sql`${wallets.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(wallets.id, params.playerWalletId),
            eq(wallets.version, playerWallet.version),
          ),
        )
        .returning();
      if (playerUpdated.length === 0) {
        throw new WalletConcurrencyError(params.playerWalletId);
      }

      // 8. UPDATE issuer wallet (credit balance).
      const issuerUpdated = await tx
        .update(wallets)
        .set({
          balance: issuerBalanceAfter,
          version: sql`${wallets.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(wallets.id, params.issuerWalletId),
            eq(wallets.version, issuerWallet.version),
          ),
        )
        .returning();
      if (issuerUpdated.length === 0) {
        throw new WalletConcurrencyError(params.issuerWalletId);
      }

      // 9. Marcar hold como released.
      await tx
        .update(walletHolds)
        .set({ releasedAt: new Date() })
        .where(eq(walletHolds.id, params.holdId));

      return { sourceTxId: sourceTx.id, targetTxId: targetTx.id };
    });
  }

  /**
   * Acredita fichas al wallet de un usuario como resultado de un depósito
   * aprobado. Genera una tx `type='deposit'` con `idempotencyKey=depositId`
   * para garantizar que dos aprobaciones simultáneas resulten en una sola
   * tx (ya el UNIQUE en idempotency_key lo enforce).
   *
   * NO valida rol/permisos del actor — eso lo hace el caller (DepositsService
   * + permission guard del controller). Esto es un primitivo del wallet.
   */
  /**
   * Sprint 50: mintea fichas DIRECTO a un wallet target (no al actor).
   * Pensado para `commissions.settle` — el admin liquida lo que se debe
   * a un beneficiary minteando fichas a su wallet (no descontando de
   * nadie). Uso interno, no expuesto vía REST.
   *
   * No hace `assertAdminTenant` — el caller (commission settle) ya valida
   * el permiso `commissions.settle`. Acá confiamos en el caller.
   */
  async mintToWallet(
    db: TenantDb,
    params: {
      walletId: string;
      amount: string;
      source: string;
      referenceId: string | null;
      idempotencyKey: string;
      reason: string;
      createdBy: string;
      counterpartyUserId: string | null;
    },
  ): Promise<WalletTransaction> {
    return this.executeTransaction(db, {
      walletId: params.walletId,
      type: 'mint',
      amount: params.amount,
      source: params.source,
      referenceId: params.referenceId,
      idempotencyKey: params.idempotencyKey,
      createdBy: params.createdBy,
      reason: params.reason,
      counterpartyUserId: params.counterpartyUserId,
    });
  }

  /**
   * F2: acredita el depósito aprobado al player como TRANSFER DOBLE ENTRADA
   * desde el wallet del issuer (Casa o socio indep dueño de la rama del player,
   * resuelto por `HouseService.resolveIssuerForPlayer`). Antes era MINT puro;
   * ahora respeta la invariante "1 ficha = 1 peso, todo respaldado" (docs/16).
   *
   * Sides:
   *   - Issuer: tx `transfer_out`, source='deposit_flow', counterparty=player.
   *   - Player: tx `deposit`,      source='deposit_flow', counterparty=issuer.
   *
   * Idempotency key: `deposit:<depositId>` (misma que la versión mint anterior,
   * para que retries entre despliegues no re-acrediten). Vive en la source tx;
   * la target queda linkeada por `related_tx_id`.
   *
   * Tira `IssuerInsufficientBalanceError` si el issuer no cubre el monto —
   * el caller lo mapea a 409 con payload accionable.
   */
  async creditFromDeposit(
    db: TenantDb,
    params: {
      issuerUserId: string;
      playerUserId: string;
      amount: string;
      depositId: string;
      actorUserId: string;
      /** Metadata para el error si el issuer no cubre el monto. */
      issuerContext?: { walletId: string; isCasa: boolean };
    },
  ): Promise<WalletTransaction> {
    try {
      const pair = await this.executeTransferPair(db, {
        actorUserId: params.actorUserId,
        sourceUserId: params.issuerUserId,
        targetUserId: params.playerUserId,
        amount: params.amount,
        sourceType: 'transfer_out',
        targetType: 'deposit',
        source: 'deposit_flow',
        referenceId: params.depositId,
        idempotencyKey: `deposit:${params.depositId}`,
      });
      // Devolvemos la tx del lado PLAYER — el caller la usa como `walletTxId`
      // del deposit (audit + relación al player).
      return pair.targetTx;
    } catch (err) {
      if (err instanceof InsufficientBalanceError && params.issuerContext) {
        throw new IssuerInsufficientBalanceError(
          params.issuerContext.walletId,
          params.issuerUserId,
          err.available,
          err.required,
          params.issuerContext.isCasa,
        );
      }
      throw err;
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Bonos: primitivos para el subsistema de bonos (sprint Bonos-1).
  // Cada uno es un wrapper fino sobre `executeTransaction` con el type y
  // source correctos. La validación funcional (definition activa, target
  // existe, etc.) la hace `UserBonusesService` antes de llamar acá.
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Debita el wallet del funder por el monto que va a fondear un bono.
   * Tx de tipo `bonus_funding` (salida).
   *
   * `idempotencyKey` típico: `bonus_grant:<grantIdempotencyKey>` —
   * garantiza que dos requests de grant con la misma key resultan en
   * UNA wallet_tx.
   */
  async executeBonusFunding(
    db: TenantDb,
    params: {
      walletId: string;
      amount: string;
      idempotencyKey: string;
      actorUserId: string;
      reason: string;
      counterpartyUserId: string;
    },
  ): Promise<WalletTransaction> {
    return this.executeTransaction(db, {
      walletId: params.walletId,
      type: 'bonus_funding',
      amount: params.amount,
      source: 'bonus_grant',
      counterpartyUserId: params.counterpartyUserId,
      idempotencyKey: params.idempotencyKey,
      createdBy: params.actorUserId,
      reason: params.reason,
    });
  }

  /**
   * Reversa: acredita al funder cuando un bono se cancela.
   * Tx de tipo `bonus_funding_revert` (entrada).
   */
  async executeBonusFundingRevert(
    db: TenantDb,
    params: {
      walletId: string;
      amount: string;
      idempotencyKey: string;
      actorUserId: string;
      reason: string;
      counterpartyUserId: string;
      relatedTxId?: string | null;
    },
  ): Promise<WalletTransaction> {
    return this.executeTransaction(db, {
      walletId: params.walletId,
      type: 'bonus_funding_revert',
      amount: params.amount,
      source: 'bonus_cancel',
      counterpartyUserId: params.counterpartyUserId,
      relatedTxId: params.relatedTxId ?? null,
      idempotencyKey: params.idempotencyKey,
      createdBy: params.actorUserId,
      reason: params.reason,
    });
  }

  /**
   * Funding de un premio de promoción (debit del funder). Equivalente a
   * `executeBonusFunding` pero source/referenceId apuntan a la promotion.
   *
   * Reusamos `bonus_funding` como type (es el flag genérico "salida de
   * fondos para una promoción/bono"). `source='promo_funding'` lo
   * distingue en queries de reporting.
   */
  async executePromotionFunding(
    db: TenantDb,
    params: {
      walletId: string;
      amount: string;
      idempotencyKey: string;
      actorUserId: string;
      reason: string;
      counterpartyUserId: string;
      referenceId: string;
    },
  ): Promise<WalletTransaction> {
    return this.executeTransaction(db, {
      walletId: params.walletId,
      type: 'bonus_funding',
      amount: params.amount,
      source: 'promo_funding',
      referenceId: params.referenceId,
      counterpartyUserId: params.counterpartyUserId,
      idempotencyKey: params.idempotencyKey,
      createdBy: params.actorUserId,
      reason: params.reason,
    });
  }

  /**
   * Credit al wallet del user por un premio de promoción. Tipo
   * `promo_reward` (entrada al user).
   */
  async executePromotionReward(
    db: TenantDb,
    params: {
      walletId: string;
      amount: string;
      idempotencyKey: string;
      actorUserId: string;
      reason: string;
      counterpartyUserId: string;
      referenceId: string;
    },
  ): Promise<WalletTransaction> {
    return this.executeTransaction(db, {
      walletId: params.walletId,
      type: 'promo_reward',
      amount: params.amount,
      source: 'promo_reward',
      referenceId: params.referenceId,
      counterpartyUserId: params.counterpartyUserId,
      idempotencyKey: params.idempotencyKey,
      createdBy: params.actorUserId,
      reason: params.reason,
    });
  }

  /**
   * Force-clear: el admin entrega las fichas remaining del bono al wallet
   * REAL del user. Tx de tipo `bonus_clear` (entrada al user).
   */
  async executeBonusClear(
    db: TenantDb,
    params: {
      walletId: string;
      amount: string;
      idempotencyKey: string;
      actorUserId: string;
      reason: string;
      counterpartyUserId: string;
      relatedTxId?: string | null;
    },
  ): Promise<WalletTransaction> {
    return this.executeTransaction(db, {
      walletId: params.walletId,
      type: 'bonus_clear',
      amount: params.amount,
      source: 'bonus_force_clear',
      counterpartyUserId: params.counterpartyUserId,
      relatedTxId: params.relatedTxId ?? null,
      idempotencyKey: params.idempotencyKey,
      createdBy: params.actorUserId,
      reason: params.reason,
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // Commissions: pago / quema desde la Casa (comisiones por red).
  // ──────────────────────────────────────────────────────────────────────

  /**
   * B-build-5: la Casa PAGA una comisión al liquidar (no se mintea). Transfer
   * Casa → beneficiary: la Casa pierde (`transfer_out`), el beneficiary gana
   * (`commission_payout`). Idempotency por payout. Tira `InsufficientBalanceError`
   * si la Casa no tiene fondos (modelo estricto — el dueño aporta capital).
   */
  async housePayCommission(
    db: TenantDb,
    params: {
      houseUserId: string;
      beneficiaryUserId: string;
      amount: string;
      payoutId: string;
      actorUserId: string;
    },
  ): Promise<TransferPairResult> {
    return this.executeTransferPair(db, {
      actorUserId: params.actorUserId,
      sourceUserId: params.houseUserId,
      targetUserId: params.beneficiaryUserId,
      amount: params.amount,
      sourceType: 'transfer_out',
      targetType: 'commission_payout',
      source: 'commission_settlement',
      referenceId: params.payoutId,
      idempotencyKey: `commission_settle:${params.payoutId}`,
      reason: `Settle commission ${params.payoutId} (desde la Casa)`,
    });
  }

  /**
   * C3: la Casa QUEMA fichas al liquidar una comisión en PLATA REAL. La plata
   * sale por fuera (transferencia bancaria), así que el equivalente en fichas
   * de la Casa se destruye para mantener el respaldo (1 ficha = 1 peso) — es,
   * en el fondo, un retiro de la comisión. Tipo `burn` (DEBIT). Tira
   * `InsufficientBalanceError` si la Casa no tiene fondos.
   */
  async houseBurn(
    db: TenantDb,
    params: {
      houseUserId: string;
      amount: string;
      referenceId?: string | null;
      idempotencyKey: string;
      actorUserId: string;
      reason: string;
      notes?: string | null;
    },
  ): Promise<WalletTransaction> {
    const wallet = await this.getOrCreateWalletForUser(db, params.houseUserId);
    return this.executeTransaction(db, {
      walletId: wallet.id,
      type: 'burn',
      amount: params.amount,
      source: 'commission_cash_settlement',
      referenceId: params.referenceId ?? null,
      idempotencyKey: params.idempotencyKey,
      createdBy: params.actorUserId,
      reason: params.reason,
      notes: params.notes ?? null,
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // Games (Sprint 35): bet / win / rollback del game loop.
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Debit del wallet por una apuesta. Tipo `bet`.
   * Idempotency: `game_bet:<sessionId>:<roundExternalId>` — defensa
   * contra retry del cliente o doble submit.
   *
   * Tira `InsufficientBalanceError` si el wallet no alcanza.
   * El caller (GameRoundsService) decide qué hacer con el error.
   */
  async placeBet(
    db: TenantDb,
    params: {
      walletId: string;
      amount: string;
      sessionId: string;
      roundExternalId: string;
      actorUserId: string;
    },
  ): Promise<WalletTransaction> {
    return this.executeTransaction(db, {
      walletId: params.walletId,
      type: 'bet',
      amount: params.amount,
      source: 'game_bet',
      referenceId: params.roundExternalId,
      idempotencyKey: `game_bet:${params.sessionId}:${params.roundExternalId}`,
      createdBy: params.actorUserId,
    });
  }

  /**
   * Credit del wallet por una ganancia. Tipo `win`.
   * Idempotency: `game_win:<sessionId>:<roundExternalId>`.
   */
  async settleWin(
    db: TenantDb,
    params: {
      walletId: string;
      amount: string;
      sessionId: string;
      roundExternalId: string;
      actorUserId: string;
    },
  ): Promise<WalletTransaction> {
    return this.executeTransaction(db, {
      walletId: params.walletId,
      type: 'win',
      amount: params.amount,
      source: 'game_win',
      referenceId: params.roundExternalId,
      idempotencyKey: `game_win:${params.sessionId}:${params.roundExternalId}`,
      createdBy: params.actorUserId,
    });
  }

  /**
   * Rollback de un round previamente settled. Tipo `rollback` (neutral
   * en `directionFor`; el caller pasa `direction` explícito).
   *
   * Caso common: refund net del round. Si user perdió, refund credita
   * el bet (direction='credit'). Si ganó, refund debita la ganancia
   * (direction='debit').
   */
  async executeGameRollback(
    db: TenantDb,
    params: {
      walletId: string;
      amount: string;
      direction: 'credit' | 'debit';
      sessionId: string;
      roundExternalId: string;
      actorUserId: string;
      reason: string;
    },
  ): Promise<WalletTransaction> {
    // `rollback` está en CREDIT_TYPES? Veamos: el enum existe pero el set
    // directionFor lo trata como 'neutral'. Pasamos type='rollback' con
    // direction explícito armado vía el método executeTransaction —
    // pero ése infiere direction de type. Para mantener el contract,
    // usamos type='win' o 'bet' según corresponde el cash flow real.
    return this.executeTransaction(db, {
      walletId: params.walletId,
      type: params.direction === 'credit' ? 'win' : 'bet',
      amount: params.amount,
      source: 'game_rollback',
      referenceId: params.roundExternalId,
      idempotencyKey: `game_rollback:${params.sessionId}:${params.roundExternalId}`,
      createdBy: params.actorUserId,
      reason: params.reason,
      notes: `rollback ${params.direction} de round ${params.roundExternalId}`,
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // Palace Casino — callbacks externos (bet/win/cancel del proveedor).
  // Estos métodos NO usan sessionId (Palace maneja sus propios rounds
  // via trans_guid). Idempotency key = `palace:{trans_guid}`.
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Debit del wallet por una apuesta de Palace.
   * Tipo `bet`, source `palace_callback`. Idempotency por transGuid.
   */
  async placeBetExternal(
    db: TenantDb,
    params: {
      walletId: string;
      amount: string;
      transGuid: string;
      account: string;
    },
  ): Promise<WalletTransaction> {
    return this.executeTransaction(db, {
      walletId: params.walletId,
      type: 'bet',
      amount: params.amount,
      source: 'palace_callback',
      referenceId: null,
      idempotencyKey: `palace:${params.transGuid}`,
      reason: `Palace bet ${params.account} ${params.transGuid}`,
    });
  }

  /**
   * Credit del wallet por un premio de Palace.
   * Tipo `win`, source `palace_callback`. Idempotency por transGuid.
   */
  async settleWinExternal(
    db: TenantDb,
    params: {
      walletId: string;
      amount: string;
      transGuid: string;
      account: string;
    },
  ): Promise<WalletTransaction> {
    return this.executeTransaction(db, {
      walletId: params.walletId,
      type: 'win',
      amount: params.amount,
      source: 'palace_callback',
      referenceId: null,
      idempotencyKey: `palace:${params.transGuid}`,
      reason: `Palace win ${params.account} ${params.transGuid}`,
    });
  }

  /**
   * Cancel de Palace — reversa un bet (credit) o win (debit).
   * Idempotency: `palace_cancel:{transGuid}`.
   */
  async cancelExternal(
    db: TenantDb,
    params: {
      walletId: string;
      amount: string;
      transGuid: string;
      cancelTransGuid: string;
      direction: 'credit' | 'debit';
      account: string;
    },
  ): Promise<WalletTransaction> {
    return this.executeTransaction(db, {
      walletId: params.walletId,
      type: params.direction === 'credit' ? 'win' : 'bet',
      amount: params.amount,
      source: 'palace_cancel',
      referenceId: null,
      idempotencyKey: `palace_cancel:${params.transGuid}`,
      reason: `Palace cancel ${params.direction} ${params.cancelTransGuid}`,
      notes: `account=${params.account}`,
    });
  }

  /**
   * Crédito (mint) genérico al wallet real de un jugador, provider-agnóstico.
   * Usado por proveedores seamless para el `win` y para el `cancel`-reversa de
   * un bet (ambos acreditan `amount`). Tipo `win` (crédito para el ledger),
   * idempotencia por la key que provee el caller (ej. `forever:{txnCode}`).
   */
  async mintExternal(
    db: TenantDb,
    params: {
      walletId: string;
      amount: string;
      idempotencyKey: string;
      source: string;
      reason: string;
    },
  ): Promise<WalletTransaction> {
    return this.executeTransaction(db, {
      walletId: params.walletId,
      type: 'win',
      amount: params.amount,
      source: params.source,
      referenceId: null,
      idempotencyKey: params.idempotencyKey,
      reason: params.reason,
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // NOTA (refactor mint/burn puro del gameplay):
  //   Antes existían `houseTakeBet` / `housePayWin` / `houseRollback` que
  //   ejecutaban la contraparte de la Casa / operador indep vía transfer
  //   doble entrada. Eliminadas: el gameplay ahora es puro burn (bet) / mint
  //   (win) del wallet del jugador — la casa/indep NO se toca en el gameplay.
  //   Las fichas del juego se emiten/queman al momento del round; el bankroll
  //   del casino se mide por la posición del jugador (deposits/withdrawals),
  //   no por el flujo de cada round.
  // ──────────────────────────────────────────────────────────────────────

  // ──────────────────────────────────────────────────────────────────────
  // Dual Wallet — bonus_balance operations.
  // `bonus_credit` agrega al bonus_balance, `bonus_debit` lo descuenta.
  // Las apuestas consumen bonus_balance PRIMERO, luego balance real.
  // Los wins siempre van al balance real (nunca al bonus).
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Credita bonus chips al wallet del jugador. Tipo `bonus_credit`.
   * Usado cuando se aprueba un depósito con bono seleccionado.
   */
  async creditBonusBalance(
    db: TenantDb,
    params: {
      walletId: string;
      amount: string;
      idempotencyKey: string;
      actorUserId: string;
      reason: string;
      referenceId?: string | null;
      relatedTxId?: string | null;
    },
  ): Promise<WalletTransaction> {
    return this.executeTransaction(db, {
      walletId: params.walletId,
      type: 'bonus_credit',
      amount: params.amount,
      source: 'deposit_bonus',
      referenceId: params.referenceId ?? null,
      relatedTxId: params.relatedTxId ?? null,
      idempotencyKey: params.idempotencyKey,
      createdBy: params.actorUserId,
      reason: params.reason,
    });
  }

  /**
   * Debita bonus chips del wallet del jugador. Tipo `bonus_debit`.
   * Usado cuando un operador saca dinero de bono manualmente
   * (`POST /tenant/bonuses/remove`): el monto vuelve al funder
   * original / Casa (LEYES E3/B4, docs/15 §Reverso).
   */
  async debitBonusBalance(
    db: TenantDb,
    params: {
      walletId: string;
      amount: string;
      idempotencyKey: string;
      actorUserId: string;
      reason: string;
      counterpartyUserId?: string | null;
      referenceId?: string | null;
      relatedTxId?: string | null;
    },
  ): Promise<WalletTransaction> {
    return this.executeTransaction(db, {
      walletId: params.walletId,
      type: 'bonus_debit',
      amount: params.amount,
      source: 'bonus_remove',
      counterpartyUserId: params.counterpartyUserId ?? null,
      referenceId: params.referenceId ?? null,
      relatedTxId: params.relatedTxId ?? null,
      idempotencyKey: params.idempotencyKey,
      createdBy: params.actorUserId,
      reason: params.reason,
    });
  }

  /**
   * Apuesta que consume bonus_balance PRIMERO, luego balance real.
   * Para el split: crea hasta 2 transacciones atómicas dentro de una
   * misma TX Postgres (bonus_debit + bet). Si el bonus cubre todo,
   * solo crea bonus_debit. Si no cubre nada, solo crea bet.
   *
   * Idempotency: usa la misma key para ambas (palace:{transGuid}).
   * El UNIQUE de idempotency_key en wallet_transactions previene
   * duplicados aunque haya race condition.
   */
  async placeBetWithBonus(
    db: TenantDb,
    params: {
      walletId: string;
      amount: string;
      transGuid: string;
      account: string;
    },
  ): Promise<WalletTransaction> {
    // Wrapper de Palace: mantiene EXACTAMENTE las mismas keys/source/reasons
    // que antes (idempotency `palace:{transGuid}`, source `palace_callback`).
    return this.placeBetWithBonusCore(db, {
      walletId: params.walletId,
      amount: params.amount,
      idempotencyKey: `palace:${params.transGuid}`,
      source: 'palace_callback',
      betReason: `Palace bet ${params.account} ${params.transGuid}`,
      bonusReason: `Palace bet bonus ${params.account} ${params.transGuid}`,
    });
  }

  /**
   * Igual que placeBetWithBonus pero provider-agnóstico: el caller provee la
   * `idempotencyKey`, `source` y `reason`. Usado por proveedores seamless que no
   * son Palace (ej. Forever, key `forever:{txnCode}`).
   */
  async placeBetWithBonusExternal(
    db: TenantDb,
    params: {
      walletId: string;
      amount: string;
      idempotencyKey: string;
      source: string;
      reason: string;
    },
  ): Promise<WalletTransaction> {
    return this.placeBetWithBonusCore(db, {
      walletId: params.walletId,
      amount: params.amount,
      idempotencyKey: params.idempotencyKey,
      source: params.source,
      betReason: params.reason,
      bonusReason: params.reason,
    });
  }

  /**
   * Núcleo compartido de la apuesta bonus-first: consume bonus_balance PRIMERO,
   * luego balance real, en una sola TX Postgres con lock + version guard +
   * idempotencia. Palace y otros proveedores seamless lo usan con su propio
   * naming (key/source/reason). NO cambia la mecánica original.
   */
  private async placeBetWithBonusCore(
    db: TenantDb,
    params: {
      walletId: string;
      amount: string;
      idempotencyKey: string;
      source: string;
      betReason: string;
      bonusReason: string;
    },
  ): Promise<WalletTransaction> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);

      // 1. Lock the wallet row
      const lockedRows = await tx
        .select()
        .from(wallets)
        .where(eq(wallets.id, params.walletId))
        .for('update')
        .limit(1);
      const lockedRow = lockedRows[0];
      if (!lockedRow) {
        throw new WalletNotFoundError(params.walletId);
      }

      // 2. Check idempotency
      const idempotencyKey = params.idempotencyKey;
      const existing = await tx
        .select()
        .from(walletTransactions)
        .where(eq(walletTransactions.idempotencyKey, idempotencyKey))
        .limit(1);
      if (existing[0]) {
        return existing[0];
      }

      const betAmountCents = this.toCents(params.amount);
      const bonusCents = this.toCents(lockedRow.bonusBalance ?? '0');
      const balanceCents = this.toCents(lockedRow.balance);

      // 3. Determine split: bonus first, then balance
      const bonusDebit = bonusCents >= betAmountCents ? betAmountCents : bonusCents;
      const balanceDebit = betAmountCents - bonusDebit;

      // 4. Validate sufficient balance. Disponible = balance - locked: lo que
      //    está en hold (retiros pendientes) no es apostable (LEYES E6). Si el
      //    chequeo falla, el callback del proveedor responde saldo insuficiente.
      const availableCents =
        balanceCents - this.toCents(lockedRow.lockedBalance ?? '0');
      if (balanceDebit > availableCents) {
        throw new InsufficientBalanceError(this.fromCents(availableCents), params.amount);
      }

      // 5. Compute new balances
      const newBonusBalance = this.fromCents(bonusCents - bonusDebit);
      const newBalance = this.fromCents(balanceCents - balanceDebit);
      const newVersion = lockedRow.version + 1;
      const now = new Date();

      const insertedTxs: WalletTransaction[] = [];

      // 6. Insert bonus_debit tx if needed
      if (bonusDebit > 0n) {
        const bonusTx: NewWalletTransaction = {
          id: generateUuidV7(),
          walletId: params.walletId,
          type: 'bonus_debit',
          amount: this.fromCents(bonusDebit),
          balanceAfter: newBalance,
          bonusBalanceAfter: newBonusBalance,
          source: params.source,
          idempotencyKey,
          reason: params.bonusReason,
        };
        const inserted = await tx.insert(walletTransactions).values(bonusTx).returning();
        insertedTxs.push(inserted[0]!);
      }

      // 7. Insert bet tx if needed
      if (balanceDebit > 0n) {
        const betTx: NewWalletTransaction = {
          id: generateUuidV7(),
          walletId: params.walletId,
          type: 'bet',
          amount: this.fromCents(balanceDebit),
          balanceAfter: newBalance,
          bonusBalanceAfter: newBonusBalance,
          source: params.source,
          // Only the bonus_debit tx gets the idempotency key
          idempotencyKey: bonusDebit > 0n ? null : idempotencyKey,
          reason: params.betReason,
        };
        const inserted = await tx.insert(walletTransactions).values(betTx).returning();
        insertedTxs.push(inserted[0]!);
      }

      // 8. Update wallet
      const updated = await tx
        .update(wallets)
        .set({
          balance: newBalance,
          bonusBalance: newBonusBalance,
          version: newVersion,
          updatedAt: now,
        })
        .where(and(eq(wallets.id, params.walletId), eq(wallets.version, lockedRow.version)))
        .returning();

      if (updated.length === 0) {
        throw new WalletConcurrencyError(params.walletId);
      }

      // Return the primary tx (bonus_debit if exists, otherwise bet)
      return insertedTxs[0]!;
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // Internals
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Asegura que el `actorUserId` tiene asignado el rol `admin_tenant`.
   * Tira `MintRoleRequiredError` si no. Defensa adicional al guard de
   * permisos (que valida `wallet.burn`).
   */
  private async assertAdminTenant(db: TenantDb, actorUserId: string): Promise<void> {
    const rows = await db
      .select({ code: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(userRoles.userId, actorUserId), eq(roles.code, 'admin_tenant')))
      .limit(1);
    if (rows.length === 0) {
      throw new MintRoleRequiredError();
    }
  }

  private async isUserAdmin(db: TenantDb, userId: string): Promise<boolean> {
    const rows = await db
      .select({ code: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(userRoles.userId, userId), eq(roles.code, 'admin_tenant')))
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Core: ejecuta una tx dentro de `db.transaction(...)`. Garantiza:
   *   - SELECT FOR UPDATE sobre el wallet (lock pesimista).
   *   - Validación de saldo si es débito.
   *   - INSERT en wallet_transactions + UPDATE en wallets, atómico.
   *   - Idempotencia: si idempotencyKey ya existe, devuelve la tx previa.
   *
   * Si el INSERT falla por unique_violation del idempotencyKey, hacemos
   * SELECT de la tx existente y la devolvemos (caso normal de retry).
   *
   * `version` del wallet se incrementa en cada update; lo usamos como
   * optimistic lock en operaciones futuras que no quieran tomar FOR UPDATE.
   */
  private async executeTransaction(
    db: TenantDb,
    params: ExecuteTxParams,
  ): Promise<WalletTransaction> {
    return db.transaction(async (tx) => {
      // lock_timeout: si por algún motivo el lock no se obtiene en 5s
      // (otra TX colgada, deadlock no detectado), abortar en lugar de
      // esperar indefinido. Mejora resilience operacional.
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);

      // 1. SELECT FOR UPDATE — bloquea la fila del wallet hasta commit.
      //    Lo hacemos PRIMERO (antes del idempotency-check) para serializar
      //    requests concurrentes sobre el mismo wallet. Sin esto, dos
      //    requests con la misma idempotencyKey podrían entrambos ver
      //    "no existe" en step 2 y luego fallar con unique_violation en
      //    el insert (race window). Tomando el lock primero, el segundo
      //    request entra al step 2 después del commit del primero y ve
      //    la fila existente.
      const lockedRows = await tx
        .select()
        .from(wallets)
        .where(eq(wallets.id, params.walletId))
        .for('update')
        .limit(1);
      const lockedRow = lockedRows[0];
      if (!lockedRow) {
        throw new WalletNotFoundError(params.walletId);
      }

      // 2. Idempotency check post-lock: si la key ya fue committedeada por
      //    otra TX previa, devolvemos la tx existente — pero sólo si los
      //    parámetros relevantes coinciden. Si difieren, es un mal uso de
      //    la key (mismo key con operación distinta) → tiramos
      //    `IdempotencyConflictError` (HTTP 409). Doc `§11`.
      if (params.idempotencyKey) {
        const existing = await tx
          .select()
          .from(walletTransactions)
          .where(eq(walletTransactions.idempotencyKey, params.idempotencyKey))
          .limit(1);
        if (existing[0]) {
          // Postgres normaliza `numeric(20,2)` a 2 decimales fijos ("33"
          // vuelve como "33.00"). Comparamos por valor (centavos) no por
          // literal string.
          const sameAmount =
            this.toCents(existing[0].amount) === this.toCents(params.amount);
          const match =
            existing[0].type === params.type &&
            sameAmount &&
            (existing[0].reason ?? null) === (params.reason ?? null) &&
            existing[0].walletId === params.walletId;
          if (!match) {
            throw new IdempotencyConflictError(params.idempotencyKey);
          }
          return existing[0];
        }
      }

      const balanceBefore = lockedRow.balance;
      const direction = this.directionFor(params.type);
      const balanceAfter = this.computeBalanceAfter(balanceBefore, params.amount, direction);

      // 3. Validar saldo en débitos. El monto disponible es balance - locked:
      //    lo que está en hold (retiros pendientes, fund reservations) NO es
      //    gastable (LEYES E6, docs/05 §7). Antes se chequeaba contra el
      //    balance TOTAL y un CHECK SQL `locked_balance <= balance` lo frenaba
      //    con un error 500 genérico; ahora es una validación explícita con la
      //    semántica correcta (InsufficientBalanceError → 409).
      if (direction === 'debit') {
        const availableCents =
          this.toCents(balanceBefore) - this.toCents(lockedRow.lockedBalance);
        if (availableCents < this.toCents(params.amount)) {
          throw new InsufficientBalanceError(
            this.fromCents(availableCents),
            params.amount,
            lockedRow.lockedBalance,
          );
        }
      }

      // 3b. Calcular bonusBalanceAfter para operaciones de bonus.
      const bonusBefore = lockedRow.bonusBalance ?? '0';
      let bonusBalanceAfter = bonusBefore;
      if (BONUS_BALANCE_CREDIT_TYPES.has(params.type)) {
        bonusBalanceAfter = this.computeBalanceAfter(bonusBefore, params.amount, 'credit');
      } else if (BONUS_BALANCE_DEBIT_TYPES.has(params.type)) {
        bonusBalanceAfter = this.computeBalanceAfter(bonusBefore, params.amount, 'debit');
        if (Number(bonusBalanceAfter) < 0) {
          throw new InsufficientBalanceError(bonusBefore, params.amount);
        }
      }

      // 4. INSERT en wallet_transactions.
      const newTx: NewWalletTransaction = {
        id: generateUuidV7(),
        walletId: params.walletId,
        type: params.type,
        amount: params.amount,
        balanceAfter,
        bonusBalanceAfter,
        source: params.source ?? null,
        referenceId: params.referenceId ?? null,
        relatedTxId: params.relatedTxId ?? null,
        counterpartyUserId: params.counterpartyUserId ?? null,
        idempotencyKey: params.idempotencyKey ?? null,
        createdBy: params.createdBy ?? null,
        reason: params.reason ?? null,
        notes: params.notes ?? null,
      };

      let insertedTx: WalletTransaction;
      try {
        const inserted = await tx.insert(walletTransactions).values(newTx).returning();
        insertedTx = inserted[0]!;
      } catch (err: unknown) {
        // 23505 = unique_violation: idempotencyKey ya existía (race entre
        // step 1 y este insert). Releemos.
        if (isUniqueViolation(err) && params.idempotencyKey) {
          const existing = await tx
            .select()
            .from(walletTransactions)
            .where(eq(walletTransactions.idempotencyKey, params.idempotencyKey))
            .limit(1);
          if (existing[0]) return existing[0];
        }
        throw err;
      }

      // 5. UPDATE wallets.balance + bonus_balance + version + updated_at.
      const updatePayload: Record<string, unknown> = {
        balance: balanceAfter,
        version: sql`${wallets.version} + 1`,
        updatedAt: new Date(),
      };
      if (bonusBalanceAfter !== bonusBefore) {
        updatePayload.bonusBalance = bonusBalanceAfter;
      }
      const updated = await tx
        .update(wallets)
        .set(updatePayload)
        .where(and(eq(wallets.id, params.walletId), eq(wallets.version, lockedRow.version)))
        .returning();

      if (updated.length === 0) {
        // Otro proceso ganó el lock (no debería pasar con FOR UPDATE pero
        // mantenemos la red por si alguna ruta futura no toma el lock).
        throw new WalletConcurrencyError(params.walletId);
      }

      return insertedTx;
    });
  }

  /**
   * Núcleo de load/unload: 2 wallets, 2 tx atómicas, anti-deadlock.
   *
   * Anti-deadlock: si dos requests concurrentes hacen A→B y B→A, podrían
   * deadlockearse si cada uno toma su source primero. Solución: tomamos
   * los locks SIEMPRE en orden ASC por wallet.id, sin importar dirección.
   * Postgres garantiza que esto rompe el ciclo (impossible deadlock).
   *
   * Idempotency: la `idempotencyKey` se guarda en la tx del lado source
   * (la primary). La tx del lado target lleva null en `idempotency_key`
   * pero queda linkeada vía `related_tx_id`. Si una segunda request entra
   * con la misma key, hacemos SELECT por la key, devolvemos el par
   * completo (re-lee la related tx).
   */
  async executeTransferPair(
    db: TenantDb,
    params: TransferPairParams,
  ): Promise<TransferPairResult> {
    if (params.sourceUserId === params.targetUserId) {
      throw new SelfTransferError();
    }

    // Validar que el target existe ANTES de empezar la TX (devuelve error
    // limpio y evita tocar wallets si el user no existe).
    const targetUserRows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, params.targetUserId))
      .limit(1);
    if (!targetUserRows[0]) {
      throw new TargetUserNotFoundError(params.targetUserId);
    }

    // Asegurar wallets existen ANTES de la TX (puede crear filas nuevas,
    // y queremos que la TX principal solo bloquee, no cree).
    const sourceWallet = await this.getOrCreateWalletForUser(db, params.sourceUserId);
    const targetWallet = await this.getOrCreateWalletForUser(db, params.targetUserId);

    return db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);

      // 1. SELECT FOR UPDATE de ambos wallets en ORDEN ASC por id.
      //    Anti-deadlock: dos requests concurrentes hacen A→B y B→A.
      //    Ambos toman locks en el mismo orden (ID ascendente), sin
      //    importar quién es source ni target → no se cruzan.
      const idsAsc = [sourceWallet.id, targetWallet.id].sort();
      const lockedRows = await tx.execute(
        sql`SELECT * FROM ${wallets} WHERE id IN (${idsAsc[0]}, ${idsAsc[1]}) ORDER BY id FOR UPDATE`,
      );
      const rows = ((lockedRows as unknown as { rows?: Wallet[] }).rows ??
        (lockedRows as unknown as Wallet[]));
      const lockedSource = rows.find((w) => w.id === sourceWallet.id);
      const lockedTarget = rows.find((w) => w.id === targetWallet.id);
      if (!lockedSource || !lockedTarget) {
        throw new WalletNotFoundError(
          !lockedSource ? sourceWallet.id : targetWallet.id,
        );
      }

      // 2. Idempotency check post-lock: si la key ya fue usada por otra
      //    TX previa, devolvemos el PAR existente.
      const existingPrimary = await tx
        .select()
        .from(walletTransactions)
        .where(eq(walletTransactions.idempotencyKey, params.idempotencyKey))
        .limit(1);
      if (existingPrimary[0]) {
        const prev = existingPrimary[0];
        const sameAmount =
          this.toCents(prev.amount) === this.toCents(params.amount);
        const match =
          prev.type === params.sourceType &&
          sameAmount &&
          prev.walletId === sourceWallet.id &&
          (prev.reason ?? null) === (params.reason ?? null);
        if (!match) {
          throw new IdempotencyConflictError(params.idempotencyKey);
        }
        // Re-leer la related y los wallets actuales para devolver el par.
        const related = await tx
          .select()
          .from(walletTransactions)
          .where(eq(walletTransactions.relatedTxId, prev.id))
          .limit(1);
        if (!related[0]) {
          throw new Error(
            `Inconsistencia: tx ${prev.id} sin related (idempotencyKey=${params.idempotencyKey}).`,
          );
        }
        const wRows = await tx
          .select()
          .from(wallets)
          .where(inArray(wallets.id, [sourceWallet.id, targetWallet.id]));
        const sourceW = wRows.find((w) => w.id === sourceWallet.id)!;
        const targetW = wRows.find((w) => w.id === targetWallet.id)!;
        return { sourceTx: prev, targetTx: related[0], sourceWallet: sourceW, targetWallet: targetW };
      }

      // 3. Calcular balances finales. El source se valida contra el monto
      //    DISPONIBLE (balance − locked_balance): lo que está en hold
      //    (retiros pendientes) no es retirable manualmente (LEYES E6). Antes
      //    se validaba contra el balance TOTAL y el CHECK SQL
      //    `locked_balance <= balance` frenaba la operación con un 500 genérico
      //    cuando quedaba locked > balance. Ahora es un rechazo explícito 409
      //    con la metadata del hold para que el front notifique al admin.
      //    Nota: la fila viene de raw SQL (claves snake_case), por eso se lee
      //    `locked_balance`, no `lockedBalance`.
      const sourceLocked = (lockedSource as unknown as { locked_balance?: string }).locked_balance ?? '0';
      const sourceAvailableCents = this.toCents(lockedSource.balance) - this.toCents(sourceLocked);
      if (sourceAvailableCents < this.toCents(params.amount)) {
        throw new InsufficientBalanceError(
          this.fromCents(sourceAvailableCents),
          params.amount,
          sourceLocked,
        );
      }
      const sourceBalanceAfter = this.computeBalanceAfter(
        lockedSource.balance,
        params.amount,
        'debit',
      );
      const targetBalanceAfter = this.computeBalanceAfter(
        lockedTarget.balance,
        params.amount,
        'credit',
      );

      // 4. INSERT source tx (primary, lleva la idempotencyKey).
      const sourceTxId = generateUuidV7();
      const newSourceTx: NewWalletTransaction = {
        id: sourceTxId,
        walletId: sourceWallet.id,
        type: params.sourceType,
        amount: params.amount,
        balanceAfter: sourceBalanceAfter,
        counterpartyUserId: params.targetUserId,
        source: params.source,
        referenceId: params.referenceId ?? null,
        idempotencyKey: params.idempotencyKey,
        createdBy: params.actorUserId,
        reason: params.reason ?? null,
        notes: params.notes ?? null,
      };
      const sourceInserted = await tx
        .insert(walletTransactions)
        .values(newSourceTx)
        .returning();
      const sourceTx = sourceInserted[0]!;

      // 5. INSERT target tx (secondary, related_tx_id = sourceTxId).
      const targetTxId = generateUuidV7();
      const newTargetTx: NewWalletTransaction = {
        id: targetTxId,
        walletId: targetWallet.id,
        type: params.targetType,
        amount: params.amount,
        balanceAfter: targetBalanceAfter,
        relatedTxId: sourceTxId,
        counterpartyUserId: params.sourceUserId,
        source: params.source,
        referenceId: params.referenceId ?? null,
        // NO ponemos idempotencyKey acá (UNIQUE constraint impide
        // duplicarla; la key vive solo en la primary).
        createdBy: params.actorUserId,
        reason: params.reason ?? null,
        notes: params.notes ?? null,
      };
      const targetInserted = await tx
        .insert(walletTransactions)
        .values(newTargetTx)
        .returning();
      const targetTx = targetInserted[0]!;

      // 6. UPDATE source wallet.
      const sourceUpdated = await tx
        .update(wallets)
        .set({
          balance: sourceBalanceAfter,
          version: sql`${wallets.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(wallets.id, sourceWallet.id), eq(wallets.version, lockedSource.version)))
        .returning();
      if (sourceUpdated.length === 0) {
        throw new WalletConcurrencyError(sourceWallet.id);
      }

      // 7. UPDATE target wallet.
      const targetUpdated = await tx
        .update(wallets)
        .set({
          balance: targetBalanceAfter,
          version: sql`${wallets.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(wallets.id, targetWallet.id), eq(wallets.version, lockedTarget.version)))
        .returning();
      if (targetUpdated.length === 0) {
        throw new WalletConcurrencyError(targetWallet.id);
      }

      return {
        sourceTx,
        targetTx,
        sourceWallet: sourceUpdated[0]!,
        targetWallet: targetUpdated[0]!,
      };
    });
  }

  private directionFor(type: WalletTxType): 'credit' | 'debit' | 'neutral' {
    if (CREDIT_TYPES.has(type)) return 'credit';
    if (DEBIT_TYPES.has(type)) return 'debit';
    // 'adjustment' y 'rollback' son neutrales acá — la dirección la maneja
    // el caller con un type ad-hoc o un pair de tx.
    return 'neutral';
  }

  /**
   * Suma/resta `amount` a `balanceBefore` según `direction`. Operación
   * con strings para preservar precisión decimal exacta (numeric(20,2)).
   *
   * Usamos BigInt sobre representación en centavos para evitar errores
   * de float (0.1 + 0.2 = 0.30000000000000004).
   */
  private computeBalanceAfter(
    balanceBefore: string,
    amount: string,
    direction: 'credit' | 'debit' | 'neutral',
  ): string {
    const beforeCents = this.toCents(balanceBefore);
    const amountCents = this.toCents(amount);
    let afterCents: bigint;
    if (direction === 'credit') afterCents = beforeCents + amountCents;
    else if (direction === 'debit') afterCents = beforeCents - amountCents;
    else afterCents = beforeCents;
    return this.fromCents(afterCents);
  }

  /** "10.50" → 1050n (centavos). Acepta números positivos con hasta 2 decimales. */
  private toCents(value: string): bigint {
    const match = /^-?\d+(?:\.(\d{1,2}))?$/.exec(value.trim());
    if (!match) {
      throw new Error(`Monto inválido para wallet: "${value}".`);
    }
    const [intPart, decPart = ''] = value.split('.');
    const padded = (decPart + '00').slice(0, 2);
    const sign = intPart!.startsWith('-') ? -1n : 1n;
    const abs = BigInt((intPart!.replace('-', '') || '0') + padded);
    return sign * abs;
  }

  /** 1050n → "10.50". */
  private fromCents(cents: bigint): string {
    const sign = cents < 0n ? '-' : '';
    const abs = cents < 0n ? -cents : cents;
    const intPart = abs / 100n;
    const decPart = (abs % 100n).toString().padStart(2, '0');
    return `${sign}${intPart}.${decPart}`;
  }
}
