/**
 * DepositsService — orquesta el flujo de carga autoservicio.
 *
 * Operaciones:
 *   - `create(actorUser, params)`: el jugador solicita depósito. Estado
 *     inicial `pending`. Valida max 2 pending/under_review por user y que
 *     el método de pago exista + esté activo.
 *   - `listForUser(userId)`: lo que un user puede ver de sus propios deps.
 *   - `listForReview(filters)`: panel del cajero (`deposits.view`).
 *   - `approve(depositId, actor)`: cajero aprueba. Genera wallet tx
 *     `type='deposit'` que acredita las chips al jugador, dentro de una
 *     TX que también marca el deposit como `approved`. Atómico.
 *   - `reject(depositId, actor, reason)`: cajero rechaza con motivo.
 *
 * Reglas duras:
 *   - approve y reject son **idempotentes** vía verificación de status:
 *     si ya está resuelto, tira `DepositAlreadyResolvedError`.
 *   - approve produce wallet tx `deposit` via `WalletService` con la misma
 *     idempotency key del depósito (deposit.id). Doble click no duplica.
 *   - El monto acreditado al wallet es `amount_chips` del depósito (lo
 *     fija el cajero al crear o el user lo propone y el cajero valida).
 */

import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  deposits,
  generateUuidV7,
  paymentMethods,
  users,
  walletTransactions,
  type Deposit,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { WalletService } from '../wallet/wallet.service';
import {
  DepositAlreadyResolvedError,
  DepositNotFoundError,
  InvalidPaymentMethodError,
  TooManyPendingDepositsError,
} from './deposits.errors';

const MAX_PENDING_PER_USER = 2;

export interface CreateDepositParams {
  actorUserId: string;
  methodId: string;
  amountFiat: string;
  currencyFiat: string;
  amountChips: string;
  receiptUrl?: string | null;
  externalRef?: string | null;
}

export interface ListFilters {
  status?: Deposit['status'] | Deposit['status'][];
  userId?: string;
  /**
   * Scope downstream: si el operador NO tiene `deposits.view_all`, el
   * controller resuelve `[actor.id, ...getActiveDescendants(actor.id)]`
   * y lo pasa acá. El service aplica `inArray(deposits.userId, userIds)`.
   * Si es `undefined`, no se aplica filter (admin sin scope, ve todo).
   * Si es `[]`, el query devuelve 0 rows (el actor no tiene downstream).
   */
  userIds?: string[];
  assignedTo?: string;
  limit?: number;
  offset?: number;
}

/**
 * Deposit + campos enriquecidos via JOIN con users y payment_methods.
 * El frontend los usa para mostrar nombres en la tabla del review queue.
 */
export interface DepositWithRelations extends Deposit {
  userUsername: string | null;
  userDisplayName: string | null;
  methodCode: string | null;
  methodName: string | null;
}

@Injectable()
export class DepositsService {
  constructor(private readonly walletService: WalletService) {}

  async create(db: TenantDb, params: CreateDepositParams): Promise<Deposit> {
    // 1. Validar método de pago.
    const methodRows = await db
      .select()
      .from(paymentMethods)
      .where(eq(paymentMethods.id, params.methodId))
      .limit(1);
    const method = methodRows[0];
    if (!method || !method.isActive) {
      throw new InvalidPaymentMethodError(params.methodId);
    }

    // 2. Validar: el user no tiene más de N depósitos pending/under_review.
    const pendingRows = await db
      .select({ n: count() })
      .from(deposits)
      .where(
        and(
          eq(deposits.userId, params.actorUserId),
          inArray(deposits.status, ['pending', 'under_review']),
        ),
      );
    const pendingCount = Number(pendingRows[0]?.n ?? 0);
    if (pendingCount >= MAX_PENDING_PER_USER) {
      throw new TooManyPendingDepositsError(pendingCount);
    }

    // 3. Insert.
    const inserted = await db
      .insert(deposits)
      .values({
        id: generateUuidV7(),
        userId: params.actorUserId,
        methodId: params.methodId,
        amountFiat: params.amountFiat,
        currencyFiat: params.currencyFiat,
        amountChips: params.amountChips,
        receiptUrl: params.receiptUrl ?? null,
        externalRef: params.externalRef ?? null,
        status: 'pending',
      })
      .returning();
    return inserted[0]!;
  }

  /** Lista los depósitos de un user específico. */
  async listForUser(db: TenantDb, userId: string, limit = 50, offset = 0): Promise<Deposit[]> {
    return db
      .select()
      .from(deposits)
      .where(eq(deposits.userId, userId))
      .orderBy(desc(deposits.createdAt))
      .limit(Math.min(limit, 200))
      .offset(Math.max(offset, 0));
  }

  /**
   * Lista para panel del cajero/admin. Filtros opcionales.
   *
   * LEFT JOIN con users + payment_methods para devolver labels enriquecidos
   * (`userUsername`, `userDisplayName`, `methodCode`, `methodName`). El
   * frontend los usa directamente sin tener que hacer queries extra para
   * mostrar nombres en la tabla.
   *
   * Scope: el `userIds` filter lo pasa el controller cuando el actor solo
   * tiene `deposits.view` (no `deposits.view_all`). Implementa "cajero ve
   * solo sus clientes" del modelo jerárquico (docs/03-jerarquia-roles.md).
   *
   * Backwards-compat: el shape devuelto sigue siendo compatible con el
   * tipo `Deposit` (todos los campos originales presentes), solo agregamos
   * fields opcionales.
   */
  async listForReview(
    db: TenantDb,
    filters: ListFilters,
  ): Promise<{ data: DepositWithRelations[]; total: number }> {
    const where = buildDepositWhere(filters);
    const limit = Math.min(filters.limit ?? 50, 200);
    const offset = Math.max(filters.offset ?? 0, 0);

    // Si `userIds` está definido pero vacío, no hay nada que matchee
    // (actor sin downstream + sin view_all). Short-circuit.
    if (filters.userIds && filters.userIds.length === 0) {
      return { data: [], total: 0 };
    }

    const rows = await db
      .select({
        deposit: deposits,
        userUsername: users.username,
        userDisplayName: users.displayName,
        methodCode: paymentMethods.code,
        methodName: paymentMethods.name,
      })
      .from(deposits)
      .leftJoin(users, eq(users.id, deposits.userId))
      .leftJoin(paymentMethods, eq(paymentMethods.id, deposits.methodId))
      .where(where)
      .orderBy(desc(deposits.createdAt), desc(deposits.id))
      .limit(limit)
      .offset(offset);

    const data: DepositWithRelations[] = rows.map((r) => ({
      ...r.deposit,
      userUsername: r.userUsername,
      userDisplayName: r.userDisplayName,
      methodCode: r.methodCode,
      methodName: r.methodName,
    }));

    const totalRows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(deposits)
      .where(where);
    const total = totalRows[0]?.n ?? 0;

    return { data, total };
  }

  /**
   * Variante para export CSV: mismos filtros que `listForReview` pero
   * permite hasta `maxLimit` rows (sin el cap de 200). Sin paginación
   * (offset 0). Usado por el endpoint `/export`.
   */
  async listForExport(
    db: TenantDb,
    filters: Omit<ListFilters, 'limit' | 'offset'>,
    maxLimit: number,
  ): Promise<{ data: DepositWithRelations[]; total: number }> {
    if (filters.userIds && filters.userIds.length === 0) {
      return { data: [], total: 0 };
    }
    const where = buildDepositWhere(filters);
    const safeLimit = Math.max(maxLimit, 1);
    const rows = await db
      .select({
        deposit: deposits,
        userUsername: users.username,
        userDisplayName: users.displayName,
        methodCode: paymentMethods.code,
        methodName: paymentMethods.name,
      })
      .from(deposits)
      .leftJoin(users, eq(users.id, deposits.userId))
      .leftJoin(paymentMethods, eq(paymentMethods.id, deposits.methodId))
      .where(where)
      .orderBy(desc(deposits.createdAt), desc(deposits.id))
      .limit(safeLimit);
    const data: DepositWithRelations[] = rows.map((r) => ({
      ...r.deposit,
      userUsername: r.userUsername,
      userDisplayName: r.userDisplayName,
      methodCode: r.methodCode,
      methodName: r.methodName,
    }));
    const totalRows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(deposits)
      .where(where);
    return { data, total: totalRows[0]?.n ?? 0 };
  }

  /** Lee un depósito por id. Tira si no existe. */
  async findById(db: TenantDb, depositId: string): Promise<Deposit> {
    const rows = await db.select().from(deposits).where(eq(deposits.id, depositId)).limit(1);
    if (!rows[0]) throw new DepositNotFoundError(depositId);
    return rows[0];
  }

  /**
   * Aprueba un depósito. Genera wallet tx `deposit` que acredita amount_chips
   * al wallet del user. Todo dentro de TX postgres.
   *
   * Idempotente: si ya está approved, simplemente lo devolvemos sin re-procesar.
   * Si está en otro estado terminal (rejected/cancelled/expired), tira.
   */
  async approve(db: TenantDb, depositId: string, actorUserId: string): Promise<Deposit> {
    return db.transaction(async (tx) => {
      // SELECT FOR UPDATE sobre el deposit para evitar doble-aprobación
      // concurrente. Usamos drizzle nativo (.for('update')) para que las
      // columnas vuelvan en camelCase tipado.
      const lockedRows = await tx
        .select()
        .from(deposits)
        .where(eq(deposits.id, depositId))
        .for('update')
        .limit(1);
      const locked = lockedRows[0];
      if (!locked) throw new DepositNotFoundError(depositId);

      if (locked.status === 'approved') {
        return locked; // idempotente
      }
      if (locked.status !== 'pending' && locked.status !== 'under_review') {
        throw new DepositAlreadyResolvedError(depositId, locked.status);
      }

      // Crear wallet tx `deposit` sobre wallet del user del depósito.
      // Pasamos `tx` (subtransacción de drizzle) como executor — el wallet
      // service abre un SAVEPOINT internamente para mantener atomicidad.
      const wallet = await this.walletService.getOrCreateWalletForUser(
        tx as unknown as TenantDb,
        locked.userId,
      );
      const walletTx = await this.walletService.creditFromDeposit(
        tx as unknown as TenantDb,
        {
          walletId: wallet.id,
          amount: locked.amountChips,
          depositId: locked.id,
          actorUserId,
        },
      );

      // UPDATE deposit a approved, linkeando wallet_tx_id.
      const updated = await tx
        .update(deposits)
        .set({
          status: 'approved',
          reviewedBy: actorUserId,
          reviewedAt: new Date(),
          walletTxId: walletTx.id,
          updatedAt: new Date(),
        })
        .where(eq(deposits.id, depositId))
        .returning();

      return updated[0]!;
    });
  }

  async reject(
    db: TenantDb,
    depositId: string,
    actorUserId: string,
    reason: string,
  ): Promise<Deposit> {
    return db.transaction(async (tx) => {
      const lockedRows = await tx
        .select()
        .from(deposits)
        .where(eq(deposits.id, depositId))
        .for('update')
        .limit(1);
      const locked = lockedRows[0];
      if (!locked) throw new DepositNotFoundError(depositId);

      if (locked.status === 'rejected') {
        return locked; // idempotente
      }
      if (locked.status !== 'pending' && locked.status !== 'under_review') {
        throw new DepositAlreadyResolvedError(depositId, locked.status);
      }

      const updated = await tx
        .update(deposits)
        .set({
          status: 'rejected',
          reviewedBy: actorUserId,
          reviewedAt: new Date(),
          rejectionReason: reason,
          updatedAt: new Date(),
        })
        .where(eq(deposits.id, depositId))
        .returning();

      return updated[0]!;
    });
  }

  /** Lee la wallet tx ligada a un deposit aprobado. NULL si no aplica. */
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
}

/**
 * Helper compartido entre `listForReview` y `listForExport` para armar el
 * WHERE clause con los mismos filtros (incluido scope `userIds`).
 *
 * Devuelve `undefined` si no hay condiciones (admin sin scope, sin filtros)
 * — Drizzle interpreta eso como "no WHERE clause".
 */
function buildDepositWhere(
  filters: Pick<ListFilters, 'status' | 'userId' | 'userIds' | 'assignedTo'>,
) {
  const conditions = [];
  if (filters.userId) conditions.push(eq(deposits.userId, filters.userId));
  if (filters.userIds && filters.userIds.length > 0) {
    conditions.push(inArray(deposits.userId, filters.userIds));
  }
  if (filters.assignedTo) conditions.push(eq(deposits.assignedTo, filters.assignedTo));
  if (filters.status) {
    const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
    conditions.push(inArray(deposits.status, statuses));
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}
