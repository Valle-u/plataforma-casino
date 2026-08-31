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
 *   - Al crear: hold por `amountChips` en el wallet del user + snapshot del
 *     issuer (F3, útil como metadata: qué banco pagará el fiat). Si no hay
 *     saldo disponible (balance - locked >= amount) → 409 INSUFFICIENT_BALANCE.
 *   - Al rechazar: release del hold. Balance no cambia.
 *   - Al marcar paid (post-F7, BURN puro): debit del balance + release del
 *     hold + wallet tx `type='withdrawal'`, todo atómico vía
 *     WalletService.debitWithHoldRelease. Las fichas se destruyen; el issuer
 *     snapshotteado NO recibe fichas — sólo paga el fiat afuera del sistema.
 *   - Al marcar failed: release del hold. Balance no cambia.
 *
 * Idempotencia: las transiciones a estados terminales (paid/rejected/failed)
 * son idempotentes — si ya está en el estado destino, devolvemos sin
 * re-procesar. Cross-state inválida tira `WithdrawalInvalidStateError`.
 *
 * Max 2 withdrawals "en curso" (pending/approved/processing) por user.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
} from 'drizzle-orm';
import {
  bankTransactions,
  generateUuidV7,
  paymentMethods,
  roles,
  userRoles,
  users,
  walletTransactions,
  withdrawals,
  type BankTransaction,
  type Withdrawal,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { fiatFromChips } from '../common/ratio';
import {
  matchedBankTxSelect,
  type MatchedBankTxFields,
} from '../common/matched-bank-tx';
import { TenantSettingsService } from '../tenant-settings/tenant-settings.service';
import { BankTransactionsService } from '../bank-transactions/bank-transactions.service';
import { HouseService } from '../house/house.service';
import {
  InsufficientBalanceError,
} from '../wallet/wallet.errors';
import { WalletService } from '../wallet/wallet.service';
import type { PayInFullWithdrawalDto } from './dto/pay-in-full-withdrawal.dto';
import {
  InvalidPaymentMethodError,
  TooManyPendingWithdrawalsError,
  WithdrawalBelowMinimumError,
  WithdrawalInvalidStateError,
  WithdrawalNotFoundError,
  WithdrawalRequiresBankTxError,
  WithdrawalHasMatchedBankTxError,
  WithdrawalTargetNotPlayerError,
} from './withdrawals.errors';
import type { CreateOnBehalfPaidWithdrawalDto } from './dto/create-on-behalf-withdrawal.dto';

const MAX_IN_FLIGHT = 2;
const IN_FLIGHT_STATUSES: Withdrawal['status'][] = ['pending', 'approved', 'processing'];

export interface CreateWithdrawalParams {
  actorUserId: string;
  methodId: string;
  amountChips: string;
  currencyFiat: string;
  targetAccount: Record<string, unknown>;
  /**
   * Si está, el retiro se crea EN NOMBRE de este jugador (el operador
   * `actorUserId` lo inició). El `userId`, el hold y el issuer van sobre el
   * jugador; `createdByOperatorId` guarda al operador. Debe ser usuario_final.
   */
  onBehalfOfUserId?: string;
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
  /** Filtros de la barra (aplican a la lista Y al export CSV). */
  fromDate?: Date;
  toDate?: Date;
  methodId?: string;
  /** true = solo con transferencia matcheada; false = solo sin match. */
  matched?: boolean;
  /** Búsqueda por username / display name / id exacto del jugador. */
  userSearch?: string;
  limit?: number;
  offset?: number;
}

/**
 * Withdrawal + campos enriquecidos via JOIN con users y payment_methods.
 * El frontend los usa para mostrar nombres en la tabla del review queue
 * sin necesidad de queries extra.
 */
export interface WithdrawalWithRelations
  extends Withdrawal,
    Partial<MatchedBankTxFields> {
  userUsername: string | null;
  userDisplayName: string | null;
  methodCode: string | null;
  methodName: string | null;
}

/** Resultado del pago completo: retiro pagado + bank_tx saliente + wallet tx. */
export interface PayInFullResult {
  withdrawal: Withdrawal;
  bankTransaction: BankTransaction | null;
  walletTx: {
    id: string;
    type: string;
    amount: string;
    balanceAfter: string;
  } | null;
}

@Injectable()
export class WithdrawalsService {
  private readonly logger = new Logger(WithdrawalsService.name);

  constructor(
    private readonly walletService: WalletService,
    private readonly houseService: HouseService,
    private readonly bankTransactions: BankTransactionsService,
    private readonly tenantSettings: TenantSettingsService,
  ) {}

  async create(db: TenantDb, params: CreateWithdrawalParams): Promise<Withdrawal> {
    // El "titular" del retiro: el jugador si es on-behalf, sino el propio actor
    // (self-service). Todo — hold, issuer, in-flight, userId — va sobre él.
    const withdrawerUserId = params.onBehalfOfUserId ?? params.actorUserId;
    const isOnBehalf = params.onBehalfOfUserId != null;

    // On-behalf: el target debe ser un jugador (usuario_final).
    if (isOnBehalf) {
      await this.assertTargetIsPlayer(db, withdrawerUserId);
    }

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

    // Plata a pagar, server-side desde el ratio del método (Parte B): el cliente
    // pide en FICHAS; la plata sale de fichas ÷ chips_per_unit.
    const amountFiat = fiatFromChips(params.amountChips, method.chipsPerUnit);

    // Mínimo de retiro configurado por el tenant (withdrawals.min_amount, en
    // fiat). Default 0 = sin mínimo. L5 (wallet = plata real).
    const minFiat = await this.tenantSettings.getNumeric(
      db,
      'withdrawals.min_amount',
      0,
    );
    if (minFiat > 0 && parseFloat(amountFiat) < minFiat) {
      throw new WithdrawalBelowMinimumError(amountFiat, minFiat);
    }

    // Validar max in-flight.
    const cnt = await db
      .select({ n: count() })
      .from(withdrawals)
      .where(
        and(
          eq(withdrawals.userId, withdrawerUserId),
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
        userId: withdrawerUserId,
        amount: params.amountChips,
        reason: `withdrawal:${withdrawalId}`,
        relatedEntityType: 'withdrawal',
        relatedEntityId: withdrawalId,
      });

      // F3 · Snapshot del issuer al momento del create: congela quién funde
      // este withdrawal aunque la jerarquía del player cambie entre create y
      // paid. No validamos saldo del issuer acá — el chequeo real es en
      // markPaid (y de todas formas el issuer RECIBE fichas del player, no
      // fondea; el balance del issuer no es la restricción).
      const issuer = await this.houseService.resolveIssuerForPlayer(
        tx as unknown as TenantDb,
        withdrawerUserId,
      );

      // On-behalf: el operador que lo inicia ES la aprobación → nace 'approved'
      // (cae directo en "Por pagar", no en la cola de revisión). Self-service
      // nace 'pending' (lo revisa el padre directo, R1).
      const inserted = await tx
        .insert(withdrawals)
        .values({
          id: withdrawalId,
          userId: withdrawerUserId,
          methodId: params.methodId,
          amountChips: params.amountChips,
          amountFiat,
          currencyFiat: params.currencyFiat,
          targetAccount: params.targetAccount,
          status: isOnBehalf ? 'approved' : 'pending',
          holdId: hold.id,
          issuerWalletId: issuer.walletId,
          issuerOperatorUserId: issuer.operatorUserId, // null si isCasa=true
          createdByOperatorId: isOnBehalf ? params.actorUserId : null,
          reviewedBy: isOnBehalf ? params.actorUserId : null,
          reviewedAt: isOnBehalf ? new Date() : null,
        })
        .returning();
      return inserted[0]!;
    });
  }

  /**
   * Valida que `userId` sea un jugador (usuario_final). Usado por el retiro
   * en nombre del jugador — no aplica a operadores. Mismo criterio que el
   * grant de bonos (R8).
   */
  private async assertTargetIsPlayer(
    db: TenantDb,
    userId: string,
  ): Promise<void> {
    const playerRoles = await db
      .select({ code: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(userRoles.userId, userId), eq(roles.code, 'usuario_final')))
      .limit(1);
    if (!playerRoles[0]) throw new WithdrawalTargetNotPlayerError(userId);
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
        // Transferencia bancaria saliente matcheada (leftJoin → null si no
        // hay match): el CSV trae el retiro + su transferencia en la misma fila.
        ...matchedBankTxSelect,
      })
      .from(withdrawals)
      .leftJoin(users, eq(users.id, withdrawals.userId))
      .leftJoin(paymentMethods, eq(paymentMethods.id, withdrawals.methodId))
      .leftJoin(
        bankTransactions,
        eq(bankTransactions.id, withdrawals.bankTransactionId),
      )
      .where(where)
      .orderBy(desc(withdrawals.createdAt), desc(withdrawals.id))
      .limit(safeLimit);
    const data: WithdrawalWithRelations[] = rows.map((r) => {
      const { withdrawal, userUsername, userDisplayName, methodCode, methodName, ...bankTx } = r;
      return {
        ...withdrawal,
        userUsername,
        userDisplayName,
        methodCode,
        methodName,
        ...bankTx,
      };
    });
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
   *
   * Sprint 52 (decisión dueño): mark-paid es ONE-CLICK, sin payload. No se
   * recibe ninguna referencia manual — `paidExternalRef` se AUTO-GENERA
   * (formato WTH-XXXXXXXX-XXXXXX) como código interno de tracking/reportes.
   *
   * Post-F7: retiro = BURN puro. Las fichas del player se DESTRUYEN al
   * marcarse paid; el issuer snapshotteado (`issuerWalletId` /
   * `issuerOperatorUserId`) sigue siendo responsable de PAGAR EL FIAT afuera
   * del sistema (no recibe fichas). El snapshot se mantiene sólo como
   * metadata contable — para saber de qué banco/sucursal sale la plata —
   * y para el response + audit log. Decisión del dueño (F7): "1 ficha = 1
   * peso EN EL SISTEMA" ⇒ al salir plata del banco, las fichas equivalentes
   * salen del ledger, y el owner reinyecta capital via inject-capital
   * periódicamente para reponer el respaldo.
   */
  async markPaid(
    db: TenantDb,
    withdrawalId: string,
    actorUserId: string,
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
      // Sprint 51: separación de funciones simétrica. El cajero no marca
      // paid sin que el empleado de confianza haya cargado la outgoing
      // bank_tx (transferencia REAL ejecutada desde el banco del tenant
      // al cliente) y haya hecho match con este withdrawal.
      if (!locked.bankTransactionId) {
        throw new WithdrawalRequiresBankTxError(withdrawalId);
      }

      // F7 · Cargamos el snapshot del issuer sólo como metadata (response +
      // audit): quién es responsable del PAGO fiat afuera del sistema. Ya
      // NO acreditamos fichas a este wallet — al burnear las del player, la
      // ficha equivalente sale del ledger. Si el row es pre-F3 (sin
      // snapshot) log un warn — el flow productivo hoy siempre snapshotea.
      if (!locked.issuerWalletId) {
        this.logger.warn(
          `withdrawal ${withdrawalId}: sin snapshot de issuer (pre-F3). Se paga como burn puro; el fiat lo cubre la Casa por defecto operativo.`,
        );
      }

      // Burn puro: destruye las fichas del wallet del player + libera el
      // hold, atómico. La wallet_tx queda con idempotencyKey=`withdrawal:<id>`.
      const walletTx = await this.walletService.debitWithHoldRelease(
        tx as unknown as TenantDb,
        {
          holdId: locked.holdId,
          withdrawalId,
          actorUserId,
        },
      );

      // Sprint 50: el hook de commissions en withdrawals fue REMOVIDO.
      // Decisión del dueño (2026-05-20): commissions solo aplican a
      // depositos. Los withdrawals son operación neutra. Si en el futuro
      // se quiere reintroducir, descomentar este bloque y reactivar
      // las rules con eventType='withdrawal_paid'.

      const updated = await tx
        .update(withdrawals)
        .set({
          status: 'paid',
          // Post-F7: linkea a la ÚNICA wallet_tx generada (burn del player).
          walletTxId: walletTx.id,
          paidExternalRef: generatePaidExternalRef(withdrawalId),
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

      // Auditoría economía (2026-07): si ya hay una outgoing bank_tx matcheada,
      // la plata fiat YA salió. Liberar el hold acá le devolvería las fichas al
      // jugador que ya cobró afuera (fichas + plata). Exigimos desmatchear la
      // bank_tx (registrar la reversión) antes de poder marcar failed.
      if (locked.bankTransactionId) {
        throw new WithdrawalHasMatchedBankTxError(
          withdrawalId,
          locked.bankTransactionId,
        );
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

  /**
   * Pago completo (Fase 2 mobile): en UNA transacción, el operador
   * financiero declara la transferencia saliente YA ejecutada, la matchea
   * con el retiro y lo marca pagado.
   *
   * Atomicidad: upload de la bank_tx → match → debitWithHoldRelease → status
   * paid, todo dentro de un único `db.transaction`. Si cualquiera falla
   * (monto no coincide sin override, banco rechaza, hold ya liberado), toda
   * la operación se revierte: no quedan bank_txs huérfanas ni holds
   * parcialmente consumidos.
   *
   * Reusa las reglas del Sprint 51:
   *   - dedupe por comprobante (receipt_storage_key) + rate limit soft del upload.
   *   - match outgoing exige monto exacto o override con motivo (≥5 chars).
   *   - debitWithHoldRelease es idempotente por `withdrawal:<id>`.
   *
   * Sprint 52 (decisión dueño): el comprobante es OBLIGATORIO — el DTO
   * exige `receiptUrl` + `receiptStorageKey` (flujo two-step: primero
   * upload-proof, después este endpoint). `paidExternalRef` se
   * AUTO-GENERA; la referencia bancaria manual fue eliminada.
   *
   * Idempotencia de alto nivel: si el retiro ya está `paid` (retry
   * post-commit), devolvemos el estado existente sin re-procesar — la bank_tx
   * y la wallet_tx se re-leen desde los IDs linkeados.
   */
  async payInFull(
    db: TenantDb,
    params: {
      withdrawalId: string;
      actorUserId: string;
      dto: PayInFullWithdrawalDto;
    },
  ): Promise<PayInFullResult> {
    const { withdrawalId, actorUserId, dto } = params;
    return db.transaction(async (tx) => {
      const txDb = tx as unknown as TenantDb;

      // Lock del withdrawal — serializa pagos concurrentes sobre el mismo retiro.
      const lockedRows = await tx
        .select()
        .from(withdrawals)
        .where(eq(withdrawals.id, withdrawalId))
        .for('update')
        .limit(1);
      const locked = lockedRows[0];
      if (!locked) throw new WithdrawalNotFoundError(withdrawalId);

      // Retry post-commit: ya está pagado → devolver estado existente.
      if (locked.status === 'paid') {
        const bankTransaction = locked.bankTransactionId
          ? await this.bankTransactions.findById(txDb, locked.bankTransactionId)
          : null;
        const walletTx = locked.walletTxId
          ? await this.getLinkedWalletTx(txDb, locked.walletTxId)
          : null;
        return { withdrawal: locked, bankTransaction, walletTx };
      }

      if (locked.status !== 'approved' && locked.status !== 'processing') {
        throw new WithdrawalInvalidStateError(
          withdrawalId,
          locked.status,
          'pay in full',
        );
      }
      if (locked.bankTransactionId) {
        // Ya hay una bank_tx saliente matcheada pero el retiro no está paid
        // (flujo clásico Sprint 51 interrumpido). El endpoint compuesto solo
        // aplica ANTES de cargar la transferencia; sino usá mark-paid.
        throw new Error(
          `Withdrawal ${withdrawalId} ya tiene transferencia bancaria matcheada — usá mark-paid con la bank_tx existente.`,
        );
      }
      if (!locked.holdId) {
        throw new Error(
          `Withdrawal ${withdrawalId} no tiene hold — inconsistencia.`,
        );
      }

      // 1. Cargar la transferencia saliente (dedupe + rate limit incluidos).
      //    Sprint 52: el comprobante es obligatorio para outgoing (el DTO y
      //    upload() lo enforcean).
      const bankTransaction = await this.bankTransactions.upload(txDb, actorUserId, {
        bankAccount: dto.bankAccount,
        amount: dto.amount,
        currency: dto.currency ?? locked.currencyFiat,
        direction: 'outgoing',
        // Idem el otro upload de este service: no se manda el nombre del
        // tercero. Ver el comentario de abajo.
        receiptUrl: dto.receiptUrl,
        receiptStorageKey: dto.receiptStorageKey,
        receiptHash: dto.receiptHash,
        receivedAt: dto.receivedAt,
        notes: dto.notes,
      });

      // 2. Match con el retiro (monto exacto o override con motivo).
      const matchedBankTx = await this.bankTransactions.matchWithdrawal(
        txDb,
        bankTransaction.id,
        withdrawalId,
        actorUserId,
        {
          override: dto.override,
          overrideReason: dto.overrideReason,
        },
      );

      // 3. Burn puro: debita fichas + libera hold (idempotente por `withdrawal:<id>`).
      const walletTx = await this.walletService.debitWithHoldRelease(txDb, {
        holdId: locked.holdId,
        withdrawalId,
        actorUserId,
      });

      // 4. Status paid + vínculos. `paidExternalRef` se auto-genera
      //    (decisión dueño: sin referencia manual).
      const updated = await tx
        .update(withdrawals)
        .set({
          status: 'paid',
          walletTxId: walletTx.id,
          paidExternalRef: generatePaidExternalRef(withdrawalId),
          paidAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(withdrawals.id, withdrawalId))
        .returning();

      this.logger.log(
        `Withdrawal ${withdrawalId} pagado completo por user=${actorUserId} bankTx=${matchedBankTx.id} amount=${matchedBankTx.amount}${
          dto.override ? ` (OVERRIDE: ${dto.overrideReason})` : ''
        }.`,
      );

      return {
        withdrawal: updated[0]!,
        bankTransaction: matchedBankTx,
        walletTx: {
          id: walletTx.id,
          type: walletTx.type,
          amount: walletTx.amount,
          balanceAfter: walletTx.balanceAfter,
        },
      };
    });
  }

  /**
   * Retiro EN NOMBRE de un jugador, pagado en UN paso. Crea el retiro (hold +
   * issuer snapshot), declara la transferencia saliente con comprobante, la
   * matchea y quema las fichas — TODO atómico en una transacción. Resultado:
   * un retiro REAL (type 'withdrawal' + burn, E6), no un unload/corrección, así
   * cuenta como retiro en las estadísticas de pago.
   *
   * Reusa las MISMAS primitivas que create() + payInFull() (placeHold,
   * resolveIssuerForPlayer, bankTransactions.upload/matchWithdrawal,
   * debitWithHoldRelease) — no introduce mecánica de plata nueva. El comprobante
   * es obligatorio (Sprint 52) y la separación de funciones se colapsa a
   * propósito: es el mismo operador el que declara y paga (decisión dueño).
   */
  async createOnBehalfPaid(
    db: TenantDb,
    params: {
      actorUserId: string;
      targetUserId: string;
      methodId: string;
      amountChips: string;
      currencyFiat: string;
      targetAccount: Record<string, unknown>;
      pay: CreateOnBehalfPaidWithdrawalDto;
    },
  ): Promise<PayInFullResult> {
    const { actorUserId, targetUserId, pay } = params;

    // Validaciones pre-tx (mismas que create()).
    await this.assertTargetIsPlayer(db, targetUserId);

    const mRows = await db
      .select()
      .from(paymentMethods)
      .where(eq(paymentMethods.id, params.methodId))
      .limit(1);
    const method = mRows[0];
    if (!method || !method.isActive) {
      throw new InvalidPaymentMethodError(params.methodId);
    }

    const amountFiat = fiatFromChips(params.amountChips, method.chipsPerUnit);
    const minFiat = await this.tenantSettings.getNumeric(
      db,
      'withdrawals.min_amount',
      0,
    );
    if (minFiat > 0 && parseFloat(amountFiat) < minFiat) {
      throw new WithdrawalBelowMinimumError(amountFiat, minFiat);
    }

    const cnt = await db
      .select({ n: count() })
      .from(withdrawals)
      .where(
        and(
          eq(withdrawals.userId, targetUserId),
          inArray(withdrawals.status, IN_FLIGHT_STATUSES),
        ),
      );
    const pendingCount = Number(cnt[0]?.n ?? 0);
    if (pendingCount >= MAX_IN_FLIGHT) {
      throw new TooManyPendingWithdrawalsError(pendingCount);
    }

    return db.transaction(async (tx) => {
      const txDb = tx as unknown as TenantDb;
      const withdrawalId = generateUuidV7();

      // 1. Hold sobre el jugador (tira si no hay saldo, antes de insertar).
      const hold = await this.walletService.placeHold(txDb, {
        userId: targetUserId,
        amount: params.amountChips,
        reason: `withdrawal:${withdrawalId}`,
        relatedEntityType: 'withdrawal',
        relatedEntityId: withdrawalId,
      });

      // 2. Snapshot del issuer (quién paga el fiat afuera).
      const issuer = await this.houseService.resolveIssuerForPlayer(
        txDb,
        targetUserId,
      );

      // 3. Insert como 'approved': el operador que lo inicia lo auto-aprueba.
      await tx.insert(withdrawals).values({
        id: withdrawalId,
        userId: targetUserId,
        methodId: params.methodId,
        amountChips: params.amountChips,
        amountFiat,
        currencyFiat: params.currencyFiat,
        targetAccount: params.targetAccount,
        status: 'approved',
        holdId: hold.id,
        issuerWalletId: issuer.walletId,
        issuerOperatorUserId: issuer.operatorUserId,
        createdByOperatorId: actorUserId,
        reviewedBy: actorUserId,
        reviewedAt: new Date(),
      });

      // 4. Transferencia saliente (comprobante obligatorio) + match.
      const bankTransaction = await this.bankTransactions.upload(txDb, actorUserId, {
        bankAccount: pay.bankAccount,
        amount: pay.amount,
        currency: pay.currency ?? params.currencyFiat,
        direction: 'outgoing',
        // NO se manda `pay.senderName`: era el nombre del JUGADOR que cobra,
        // precargado por el modal de pago. Es exactamente el dato de tercero
        // que se dejó de guardar; si siguiera acá, entraría por atrás en cada
        // retiro pagado y el cambio quedaría a medias y en silencio.
        receiptUrl: pay.receiptUrl,
        receiptStorageKey: pay.receiptStorageKey,
        receiptHash: pay.receiptHash,
        receivedAt: pay.receivedAt,
        notes: pay.notes,
      });
      const matchedBankTx = await this.bankTransactions.matchWithdrawal(
        txDb,
        bankTransaction.id,
        withdrawalId,
        actorUserId,
        { override: pay.override, overrideReason: pay.overrideReason },
      );

      // 5. Burn puro: debita fichas del jugador + libera hold (E6).
      const walletTx = await this.walletService.debitWithHoldRelease(txDb, {
        holdId: hold.id,
        withdrawalId,
        actorUserId,
      });

      // 6. Status paid + vínculos.
      const updated = await tx
        .update(withdrawals)
        .set({
          status: 'paid',
          walletTxId: walletTx.id,
          paidExternalRef: generatePaidExternalRef(withdrawalId),
          paidAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(withdrawals.id, withdrawalId))
        .returning();

      this.logger.log(
        `Withdrawal on-behalf ${withdrawalId} creado+pagado por operador=${actorUserId} ` +
          `para jugador=${targetUserId} bankTx=${matchedBankTx.id} amount=${matchedBankTx.amount}` +
          `${pay.override ? ` (OVERRIDE: ${pay.overrideReason})` : ''}.`,
      );

      return {
        withdrawal: updated[0]!,
        bankTransaction: matchedBankTx,
        walletTx: {
          id: walletTx.id,
          type: walletTx.type,
          amount: walletTx.amount,
          balanceAfter: walletTx.balanceAfter,
        },
      };
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
  filters: Pick<
    ListFilters,
    | 'status'
    | 'userId'
    | 'userIds'
    | 'assignedTo'
    | 'fromDate'
    | 'toDate'
    | 'methodId'
    | 'matched'
    | 'userSearch'
  >,
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
  if (filters.fromDate) conditions.push(gte(withdrawals.createdAt, filters.fromDate));
  if (filters.toDate) conditions.push(lte(withdrawals.createdAt, filters.toDate));
  if (filters.methodId) conditions.push(eq(withdrawals.methodId, filters.methodId));
  if (filters.matched === true) conditions.push(isNotNull(withdrawals.bankTransactionId));
  if (filters.matched === false) conditions.push(isNull(withdrawals.bankTransactionId));
  if (filters.userSearch) {
    const q = filters.userSearch.trim();
    if (q) {
      const like = `%${q}%`;
      conditions.push(
        sql`${withdrawals.userId} in (select ${users.id} from ${users} where ${users.username} ilike ${like} or coalesce(${users.displayName}, '') ilike ${like} or ${users.id}::text = ${q})`,
      );
    }
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}

/**
 * Sprint 52 (decisión dueño): la referencia externa de pago se AUTO-GENERA.
 * El operador ya no escribe ninguna referencia manual al marcar un retiro
 * como pagado — el código interno `WTH-XXXXXXXX-XXXXXX` sirve para tracking
 * y reportes (CSV de retiros). Derivada del id del retiro + random alfanumérico.
 */
function generatePaidExternalRef(withdrawalId: string): string {
  const idPart = withdrawalId.replace(/-/g, '').slice(0, 8).toUpperCase();
  const randomPart = Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase();
  return `WTH-${idPart}-${randomPart}`;
}
