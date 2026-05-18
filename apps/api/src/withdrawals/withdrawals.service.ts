/**
 * WithdrawalsService — flujo de retiro del jugador con holds.
 *
 * Estados y transiciones:
 *   pending     → approved (cajero/admin con withdrawals.approve)
 *               → rejected (cajero/admin con withdrawals.reject)
 *   approved    → processing → paid (pagador externo, withdrawals.process)
 *                            → failed (pagador externo, withdrawals.process)
 *
 * Reglas:
 *   - Al crear: hold por `amountChips` en el wallet del user. Si no hay
 *     saldo disponible (balance - locked >= amount) → 409 INSUFFICIENT_BALANCE.
 *   - Al rechazar: release del hold. Balance no cambia.
 *   - Al marcar paid: debit del balance + release del hold + wallet tx
 *     `type='withdrawal'`, todo atómico via WalletService.debitWithHoldRelease.
 *   - Al marcar failed: release del hold. Balance no cambia.
 *
 * Idempotencia: las transiciones a estados terminales (paid/rejected/failed)
 * son idempotentes — si ya está en el estado destino, devolvemos sin
 * re-procesar. Cross-state inválida tira `WithdrawalInvalidStateError`.
 *
 * Max 2 withdrawals "en curso" (pending/approved/processing) por user.
 */

import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  generateUuidV7,
  paymentMethods,
  users,
  walletTransactions,
  withdrawals,
  type Withdrawal,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import {
  InsufficientBalanceError,
} from '../wallet/wallet.errors';
import { WalletService } from '../wallet/wallet.service';
import {
  InvalidPaymentMethodError,
  TooManyPendingWithdrawalsError,
  WithdrawalInvalidStateError,
  WithdrawalNotFoundError,
} from './withdrawals.errors';

const MAX_IN_FLIGHT = 2;
const IN_FLIGHT_STATUSES: Withdrawal['status'][] = ['pending', 'approved', 'processing'];

export interface CreateWithdrawalParams {
  actorUserId: string;
  methodId: string;
  amountChips: string;
  amountFiat: string;
  currencyFiat: string;
  targetAccount: Record<string, unknown>;
}

export interface ListFilters {
  status?: Withdrawal['status'] | Withdrawal['status'][];
  userId?: string;
  /**
   * Scope downstream del actor. Si `undefined`, no se filtra (admin con
   * `withdrawals.view_all`). Si `[]`, devuelve 0 rows. Sino, `inArray`.
   */
  userIds?: string[];
  assignedTo?: string;
  limit?: number;
  offset?: number;
}

/**
 * Withdrawal + campos enriquecidos via JOIN con users y payment_methods.
 * El frontend los usa para mostrar nombres en la tabla del review queue
 * sin necesidad de queries extra.
 */
export interface WithdrawalWithRelations extends Withdrawal {
  userUsername: string | null;
  userDisplayName: string | null;
  methodCode: string | null;
  methodName: string | null;
}

@Injectable()
export class WithdrawalsService {
  constructor(private readonly walletService: WalletService) {}

  async create(db: TenantDb, params: CreateWithdrawalParams): Promise<Withdrawal> {
    // Validar método.
    const mRows = await db
      .select()
      .from(paymentMethods)
      .where(eq(paymentMethods.id, params.methodId))
      .limit(1);
    const method = mRows[0];
    if (!method || !method.isActive) {
      throw new InvalidPaymentMethodError(params.methodId);
    }

    // Validar max in-flight.
    const cnt = await db
      .select({ n: count() })
      .from(withdrawals)
      .where(
        and(
          eq(withdrawals.userId, params.actorUserId),
          inArray(withdrawals.status, IN_FLIGHT_STATUSES),
        ),
      );
    const pendingCount = Number(cnt[0]?.n ?? 0);
    if (pendingCount >= MAX_IN_FLIGHT) {
      throw new TooManyPendingWithdrawalsError(pendingCount);
    }

    // Insert withdrawal pending + hold sobre el wallet, atómico.
    return db.transaction(async (tx) => {
      const withdrawalId = generateUuidV7();
      // Hold primero — si no hay saldo, tira ANTES de insertar el withdrawal.
      const hold = await this.walletService.placeHold(tx as unknown as TenantDb, {
        userId: params.actorUserId,
        amount: params.amountChips,
        reason: `withdrawal:${withdrawalId}`,
        relatedEntityType: 'withdrawal',
        relatedEntityId: withdrawalId,
      });

      const inserted = await tx
        .insert(withdrawals)
        .values({
          id: withdrawalId,
          userId: params.actorUserId,
          methodId: params.methodId,
          amountChips: params.amountChips,
          amountFiat: params.amountFiat,
          currencyFiat: params.currencyFiat,
          targetAccount: params.targetAccount,
          status: 'pending',
          holdId: hold.id,
        })
        .returning();
      return inserted[0]!;
    });
  }

  async listForUser(
    db: TenantDb,
    userId: string,
    limit = 50,
    offset = 0,
  ): Promise<Withdrawal[]> {
    return db
      .select()
      .from(withdrawals)
      .where(eq(withdrawals.userId, userId))
      .orderBy(desc(withdrawals.createdAt))
      .limit(Math.min(limit, 200))
      .offset(Math.max(offset, 0));
  }

  /**
   * Lista para panel cajero/admin con LEFT JOIN a users + payment_methods.
   * El frontend usa los labels enriquecidos sin queries extra.
   */
  async listForReview(
    db: TenantDb,
    filters: ListFilters,
  ): Promise<{ data: WithdrawalWithRelations[]; total: number }> {
    if (filters.userIds && filters.userIds.length === 0) {
      return { data: [], total: 0 };
    }
    const where = buildWithdrawalWhere(filters);
    const limit = Math.min(filters.limit ?? 50, 200);
    const offset = Math.max(filters.offset ?? 0, 0);

    const rows = await db
      .select({
        withdrawal: withdrawals,
        userUsername: users.username,
        userDisplayName: users.displayName,
        methodCode: paymentMethods.code,
        methodName: paymentMethods.name,
      })
      .from(withdrawals)
      .leftJoin(users, eq(users.id, withdrawals.userId))
      .leftJoin(paymentMethods, eq(paymentMethods.id, withdrawals.methodId))
      .where(where)
      .orderBy(desc(withdrawals.createdAt), desc(withdrawals.id))
      .limit(limit)
      .offset(offset);

    const data: WithdrawalWithRelations[] = rows.map((r) => ({
      ...r.withdrawal,
      userUsername: r.userUsername,
      userDisplayName: r.userDisplayName,
      methodCode: r.methodCode,
      methodName: r.methodName,
    }));

    const totalRows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(withdrawals)
      .where(where);

    return { data, total: totalRows[0]?.n ?? 0 };
  }

  /**
   * Variante para export CSV: mismos filtros que `listForReview` pero
   * sin el cap de 200, hasta `maxLimit`. Sin paginación (offset 0).
   */
  async listForExport(
    db: TenantDb,
    filters: Omit<ListFilters, 'limit' | 'offset'>,
    maxLimit: number,
  ): Promise<{ data: WithdrawalWithRelations[]; total: number }> {
    if (filters.userIds && filters.userIds.length === 0) {
      return { data: [], total: 0 };
    }
    const where = buildWithdrawalWhere(filters);
    const safeLimit = Math.max(maxLimit, 1);
    const rows = await db
      .select({
        withdrawal: withdrawals,
        userUsername: users.username,
        userDisplayName: users.displayName,
        methodCode: paymentMethods.code,
        methodName: paymentMethods.name,
      })
      .from(withdrawals)
      .leftJoin(users, eq(users.id, withdrawals.userId))
      .leftJoin(paymentMethods, eq(paymentMethods.id, withdrawals.methodId))
      .where(where)
      .orderBy(desc(withdrawals.createdAt), desc(withdrawals.id))
      .limit(safeLimit);
    const data: WithdrawalWithRelations[] = rows.map((r) => ({
      ...r.withdrawal,
      userUsername: r.userUsername,
      userDisplayName: r.userDisplayName,
      methodCode: r.methodCode,
      methodName: r.methodName,
    }));
    const totalRows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(withdrawals)
      .where(where);
    return { data, total: totalRows[0]?.n ?? 0 };
  }

  async findById(db: TenantDb, id: string): Promise<Withdrawal> {
    const rows = await db.select().from(withdrawals).where(eq(withdrawals.id, id)).limit(1);
    if (!rows[0]) throw new WithdrawalNotFoundError(id);
    return rows[0];
  }

  /** Approve: pending → approved. NO mueve saldo aún (eso es process/paid). */
  async approve(db: TenantDb, withdrawalId: string, actorUserId: string): Promise<Withdrawal> {
    return db.transaction(async (tx) => {
      const lockedRows = await tx
        .select()
        .from(withdrawals)
        .where(eq(withdrawals.id, withdrawalId))
        .for('update')
        .limit(1);
      const locked = lockedRows[0];
      if (!locked) throw new WithdrawalNotFoundError(withdrawalId);
      if (locked.status === 'approved') return locked; // idempotente
      if (locked.status !== 'pending') {
        throw new WithdrawalInvalidStateError(withdrawalId, locked.status, 'approve');
      }

      const updated = await tx
        .update(withdrawals)
        .set({
          status: 'approved',
          reviewedBy: actorUserId,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(withdrawals.id, withdrawalId))
        .returning();
      return updated[0]!;
    });
  }

  /** Reject: pending → rejected. Libera el hold. */
  async reject(
    db: TenantDb,
    withdrawalId: string,
    actorUserId: string,
    reason: string,
  ): Promise<Withdrawal> {
    return db.transaction(async (tx) => {
      const lockedRows = await tx
        .select()
        .from(withdrawals)
        .where(eq(withdrawals.id, withdrawalId))
        .for('update')
        .limit(1);
      const locked = lockedRows[0];
      if (!locked) throw new WithdrawalNotFoundError(withdrawalId);
      if (locked.status === 'rejected') return locked;
      if (locked.status !== 'pending') {
        throw new WithdrawalInvalidStateError(withdrawalId, locked.status, 'reject');
      }

      const updated = await tx
        .update(withdrawals)
        .set({
          status: 'rejected',
          reviewedBy: actorUserId,
          reviewedAt: new Date(),
          rejectionReason: reason,
          updatedAt: new Date(),
        })
        .where(eq(withdrawals.id, withdrawalId))
        .returning();

      if (locked.holdId) {
        await this.walletService.releaseHold(tx as unknown as TenantDb, locked.holdId);
      }

      return updated[0]!;
    });
  }

  /**
   * Process: approved → paid (success) o approved → failed (con motivo).
   * En `paid`: debita el balance, libera el hold, genera wallet tx withdrawal.
   * En `failed`: solo libera el hold.
   */
  async markPaid(
    db: TenantDb,
    withdrawalId: string,
    actorUserId: string,
    externalRef: string,
  ): Promise<Withdrawal> {
    return db.transaction(async (tx) => {
      const lockedRows = await tx
        .select()
        .from(withdrawals)
        .where(eq(withdrawals.id, withdrawalId))
        .for('update')
        .limit(1);
      const locked = lockedRows[0];
      if (!locked) throw new WithdrawalNotFoundError(withdrawalId);
      if (locked.status === 'paid') return locked; // idempotente
      if (locked.status !== 'approved' && locked.status !== 'processing') {
        throw new WithdrawalInvalidStateError(withdrawalId, locked.status, 'mark paid');
      }
      if (!locked.holdId) {
        throw new Error(`Withdrawal ${withdrawalId} no tiene hold — inconsistencia.`);
      }

      const walletTx = await this.walletService.debitWithHoldRelease(
        tx as unknown as TenantDb,
        {
          holdId: locked.holdId,
          withdrawalId,
          actorUserId,
        },
      );

      const updated = await tx
        .update(withdrawals)
        .set({
          status: 'paid',
          walletTxId: walletTx.id,
          paidExternalRef: externalRef,
          paidAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(withdrawals.id, withdrawalId))
        .returning();
      return updated[0]!;
    });
  }

  async markFailed(
    db: TenantDb,
    withdrawalId: string,
    _actorUserId: string,
    reason: string,
  ): Promise<Withdrawal> {
    return db.transaction(async (tx) => {
      const lockedRows = await tx
        .select()
        .from(withdrawals)
        .where(eq(withdrawals.id, withdrawalId))
        .for('update')
        .limit(1);
      const locked = lockedRows[0];
      if (!locked) throw new WithdrawalNotFoundError(withdrawalId);
      if (locked.status === 'failed') return locked;
      if (locked.status !== 'approved' && locked.status !== 'processing') {
        throw new WithdrawalInvalidStateError(withdrawalId, locked.status, 'mark failed');
      }

      if (locked.holdId) {
        await this.walletService.releaseHold(tx as unknown as TenantDb, locked.holdId);
      }

      const updated = await tx
        .update(withdrawals)
        .set({
          status: 'failed',
          failureReason: reason,
          updatedAt: new Date(),
        })
        .where(eq(withdrawals.id, withdrawalId))
        .returning();
      return updated[0]!;
    });
  }

  async getLinkedWalletTx(
    db: TenantDb,
    walletTxId: string,
  ): Promise<{ id: string; type: string; amount: string; balanceAfter: string } | null> {
    const rows = await db
      .select()
      .from(walletTransactions)
      .where(eq(walletTransactions.id, walletTxId))
      .limit(1);
    if (!rows[0]) return null;
    return {
      id: rows[0].id,
      type: rows[0].type,
      amount: rows[0].amount,
      balanceAfter: rows[0].balanceAfter,
    };
  }

  // Re-export for test purposes / callers que quieran ver el error.
  static readonly InsufficientBalanceError = InsufficientBalanceError;
}

/**
 * Helper compartido para armar el WHERE clause con scope opcional.
 * Devuelve `undefined` si no hay condiciones.
 */
function buildWithdrawalWhere(
  filters: Pick<ListFilters, 'status' | 'userId' | 'userIds' | 'assignedTo'>,
) {
  const conditions = [];
  if (filters.userId) conditions.push(eq(withdrawals.userId, filters.userId));
  if (filters.userIds && filters.userIds.length > 0) {
    conditions.push(inArray(withdrawals.userId, filters.userIds));
  }
  if (filters.assignedTo) conditions.push(eq(withdrawals.assignedTo, filters.assignedTo));
  if (filters.status) {
    const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
    conditions.push(inArray(withdrawals.status, statuses));
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}
