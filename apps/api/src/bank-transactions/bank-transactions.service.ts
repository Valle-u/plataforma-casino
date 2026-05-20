/**
 * BankTransactionsService — Sprint 50 (separación de funciones).
 *
 * Responsabilidades:
 *   - CRUD de `bank_transactions` con check de duplicados.
 *   - Matching atómico bank_tx ↔ deposit:
 *       1. lock SELECT FOR UPDATE de la bank_tx + el deposit.
 *       2. valida que ambos estén "libres" (bank_tx unmatched, deposit sin bank_tx).
 *       3. valida monto exacto (o requiere overrideReason).
 *       4. UPDATE deposits.bank_transaction_id + UPDATE bank_tx.{status,matched_*}.
 *   - Unmatching para revertir asociación (solo si el deposit todavía no
 *     fue aprobado).
 *
 * Lo que NO hace:
 *   - NO aprueba el deposit. El matching es prerrequisito; el approve se
 *     hace después desde `DepositsService.approve`.
 *   - NO ejecuta wallet transfers. Eso vive en deposits/wallet/commissions.
 */

import { Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  bankTransactions,
  deposits,
  users,
  type BankTransaction,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import {
  BankTransactionAlreadyMatchedError,
  BankTransactionAmountMismatchError,
  BankTransactionDuplicateRefError,
  BankTransactionNotFoundError,
  DepositAlreadyHasBankTxError,
} from './bank-transactions.errors';
import type {
  UploadBankTransactionDto,
  MatchBankTransactionDto,
} from './dto/upload-bank-tx.dto';

export interface ListFilters {
  status?: 'unmatched' | 'matched' | 'disputed';
  bankAccount?: string;
  amount?: string;
  dateFrom?: Date;
  dateTo?: Date;
  uploadedBy?: string;
  limit?: number;
  offset?: number;
}

export interface BankTxRow extends BankTransaction {
  uploaderUsername: string | null;
  matchedDepositRef: string | null;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

@Injectable()
export class BankTransactionsService {
  private readonly logger = new Logger(BankTransactionsService.name);

  // ──────────────────────────────────────────────────────────────────
  // Upload (empleado de confianza)
  // ──────────────────────────────────────────────────────────────────

  /**
   * Carga una nueva bank_transaction. Si `bankReference` está presente,
   * verifica duplicado contra (bankAccount, bankReference) y tira 409
   * si ya existe (UNIQUE index lo enforce a nivel DB, pero queremos
   * mensaje amigable).
   */
  async upload(
    db: TenantDb,
    actorId: string,
    dto: UploadBankTransactionDto,
  ): Promise<BankTransaction> {
    // Pre-check idempotencia por bankReference.
    if (dto.bankReference) {
      const existing = await db
        .select({ id: bankTransactions.id })
        .from(bankTransactions)
        .where(
          and(
            eq(bankTransactions.bankAccount, dto.bankAccount),
            eq(bankTransactions.bankReference, dto.bankReference),
          ),
        )
        .limit(1);
      if (existing.length > 0) {
        throw new BankTransactionDuplicateRefError(
          dto.bankAccount,
          dto.bankReference,
        );
      }
    }

    const inserted = await db
      .insert(bankTransactions)
      .values({
        bankAccount: dto.bankAccount,
        amount: dto.amount,
        currency: dto.currency ?? 'ARS',
        senderName: dto.senderName ?? null,
        senderCbu: dto.senderCbu ?? null,
        reference: dto.reference ?? null,
        bankReference: dto.bankReference ?? null,
        receivedAt: new Date(dto.receivedAt),
        uploadedBy: actorId,
        status: 'unmatched',
        notes: dto.notes ?? null,
      })
      .returning();

    const row = inserted[0]!;
    this.logger.log(
      `BankTx ${row.id} cargada por user=${actorId} amount=${row.amount} from=${row.senderName ?? 'sin remitente'}.`,
    );
    return row;
  }

  // ──────────────────────────────────────────────────────────────────
  // List + detail
  // ──────────────────────────────────────────────────────────────────

  async list(
    db: TenantDb,
    filters: ListFilters,
  ): Promise<{
    data: BankTxRow[];
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  }> {
    const limit = Math.min(filters.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const offset = Math.max(filters.offset ?? 0, 0);

    const conds = [];
    if (filters.status) conds.push(eq(bankTransactions.status, filters.status));
    if (filters.bankAccount) conds.push(eq(bankTransactions.bankAccount, filters.bankAccount));
    if (filters.amount) conds.push(eq(bankTransactions.amount, filters.amount));
    if (filters.uploadedBy) conds.push(eq(bankTransactions.uploadedBy, filters.uploadedBy));
    if (filters.dateFrom) conds.push(sql`${bankTransactions.receivedAt} >= ${filters.dateFrom}`);
    if (filters.dateTo) conds.push(sql`${bankTransactions.receivedAt} <= ${filters.dateTo}`);
    const where = conds.length > 0 ? and(...conds) : undefined;

    const totalRow = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(bankTransactions)
      .where(where);
    const total = totalRow[0]?.count ?? 0;

    const rows = await db
      .select({
        id: bankTransactions.id,
        bankAccount: bankTransactions.bankAccount,
        amount: bankTransactions.amount,
        currency: bankTransactions.currency,
        senderName: bankTransactions.senderName,
        senderCbu: bankTransactions.senderCbu,
        reference: bankTransactions.reference,
        bankReference: bankTransactions.bankReference,
        receivedAt: bankTransactions.receivedAt,
        status: bankTransactions.status,
        uploadedBy: bankTransactions.uploadedBy,
        uploadedAt: bankTransactions.uploadedAt,
        matchedDepositId: bankTransactions.matchedDepositId,
        matchedBy: bankTransactions.matchedBy,
        matchedAt: bankTransactions.matchedAt,
        overrideReason: bankTransactions.overrideReason,
        notes: bankTransactions.notes,
        createdAt: bankTransactions.createdAt,
        updatedAt: bankTransactions.updatedAt,
        uploaderUsername: users.username,
      })
      .from(bankTransactions)
      .leftJoin(users, eq(users.id, bankTransactions.uploadedBy))
      .where(where)
      .orderBy(desc(bankTransactions.receivedAt))
      .limit(limit)
      .offset(offset);

    const data = rows.map((r): BankTxRow => ({ ...r, matchedDepositRef: null }));

    return {
      data,
      total,
      limit,
      offset,
      hasMore: offset + data.length < total,
    };
  }

  async findById(db: TenantDb, id: string): Promise<BankTransaction | null> {
    const rows = await db
      .select()
      .from(bankTransactions)
      .where(eq(bankTransactions.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Devuelve bank_transactions sin matchear filtradas por monto exacto.
   * Sirve para el selector "matchear este deposit con qué transferencia".
   */
  async findUnmatchedByAmount(
    db: TenantDb,
    amount: string,
  ): Promise<BankTransaction[]> {
    return db
      .select()
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.status, 'unmatched'),
          eq(bankTransactions.amount, amount),
        ),
      )
      .orderBy(desc(bankTransactions.receivedAt))
      .limit(20);
  }

  /**
   * Devuelve TODAS las bank_transactions sin matchear (para override:
   * el cajero quiere ver todo, no solo las del monto exacto).
   */
  async findAllUnmatched(db: TenantDb): Promise<BankTransaction[]> {
    return db
      .select()
      .from(bankTransactions)
      .where(eq(bankTransactions.status, 'unmatched'))
      .orderBy(desc(bankTransactions.receivedAt))
      .limit(50);
  }

  // ──────────────────────────────────────────────────────────────────
  // Match / Unmatch
  // ──────────────────────────────────────────────────────────────────

  /**
   * Matchea una bank_tx con un deposit. Atómico (transacción interna).
   *
   * Reglas:
   *   - bank_tx debe estar 'unmatched'.
   *   - deposit debe estar 'pending' o 'under_review' (no approved/rejected).
   *   - deposit NO debe tener ya una bank_tx asociada.
   *   - Si los montos NO coinciden Y no hay override → tira AmountMismatchError.
   *   - Override exige `overrideReason` ≥ 5 chars.
   */
  async match(
    db: TenantDb,
    bankTxId: string,
    depositId: string,
    actorId: string,
    dto: MatchBankTransactionDto,
  ): Promise<BankTransaction> {
    return db.transaction(async (tx) => {
      // Lock ambos rows.
      const bankTxRows = await tx
        .select()
        .from(bankTransactions)
        .where(eq(bankTransactions.id, bankTxId))
        .for('update')
        .limit(1);
      const bankTx = bankTxRows[0];
      if (!bankTx) throw new BankTransactionNotFoundError(bankTxId);

      if (bankTx.status === 'matched') {
        throw new BankTransactionAlreadyMatchedError(
          bankTxId,
          bankTx.matchedDepositId ?? 'unknown',
        );
      }

      const depRows = await tx
        .select()
        .from(deposits)
        .where(eq(deposits.id, depositId))
        .for('update')
        .limit(1);
      const dep = depRows[0];
      if (!dep) throw new Error(`Deposit ${depositId} no existe.`);

      if (dep.bankTransactionId) {
        throw new DepositAlreadyHasBankTxError(depositId);
      }
      if (dep.status !== 'pending' && dep.status !== 'under_review') {
        throw new Error(
          `Deposit ${depositId} ya está en status ${dep.status} — no se puede matchear.`,
        );
      }

      // Validar monto exacto si no override.
      const amountsMatch = Number(bankTx.amount) === Number(dep.amountFiat);
      if (!amountsMatch && !dto.override) {
        throw new BankTransactionAmountMismatchError(
          bankTx.amount,
          dep.amountFiat,
        );
      }
      if (!amountsMatch && dto.override && (!dto.overrideReason || dto.overrideReason.length < 5)) {
        throw new Error('overrideReason requerido (≥5 chars) cuando los montos no coinciden.');
      }

      const now = new Date();

      // Update bank_tx.
      const updatedBankTx = await tx
        .update(bankTransactions)
        .set({
          status: 'matched',
          matchedDepositId: depositId,
          matchedBy: actorId,
          matchedAt: now,
          overrideReason: !amountsMatch ? dto.overrideReason : null,
          updatedAt: now,
        })
        .where(eq(bankTransactions.id, bankTxId))
        .returning();

      // Update deposit (linkea backward).
      await tx
        .update(deposits)
        .set({
          bankTransactionId: bankTxId,
          updatedAt: now,
        })
        .where(eq(deposits.id, depositId));

      this.logger.log(
        `BankTx ${bankTxId} matched con deposit ${depositId} por user=${actorId}${
          dto.override ? ` (OVERRIDE: ${dto.overrideReason})` : ''
        }.`,
      );

      return updatedBankTx[0]!;
    });
  }

  /**
   * Revierte un match. Solo permitido si el deposit aún no fue aprobado.
   * Útil para "ups, matché con la transferencia equivocada".
   */
  async unmatch(
    db: TenantDb,
    bankTxId: string,
    actorId: string,
  ): Promise<BankTransaction> {
    return db.transaction(async (tx) => {
      const bankTxRows = await tx
        .select()
        .from(bankTransactions)
        .where(eq(bankTransactions.id, bankTxId))
        .for('update')
        .limit(1);
      const bankTx = bankTxRows[0];
      if (!bankTx) throw new BankTransactionNotFoundError(bankTxId);

      if (bankTx.status !== 'matched' || !bankTx.matchedDepositId) {
        throw new Error('La bank_tx no está matcheada.');
      }

      // Verificar que el deposit asociado no esté aprobado.
      const depRows = await tx
        .select()
        .from(deposits)
        .where(eq(deposits.id, bankTx.matchedDepositId))
        .limit(1);
      const dep = depRows[0];
      if (dep && dep.status === 'approved') {
        throw new Error(
          `No se puede desmatchear: el deposit ${dep.id} ya fue aprobado.`,
        );
      }

      const now = new Date();

      // Limpiar bank_tx.
      const updated = await tx
        .update(bankTransactions)
        .set({
          status: 'unmatched',
          matchedDepositId: null,
          matchedBy: null,
          matchedAt: null,
          overrideReason: null,
          updatedAt: now,
        })
        .where(eq(bankTransactions.id, bankTxId))
        .returning();

      // Limpiar deposit.
      if (dep) {
        await tx
          .update(deposits)
          .set({ bankTransactionId: null, updatedAt: now })
          .where(eq(deposits.id, dep.id));
      }

      this.logger.log(
        `BankTx ${bankTxId} unmatched por user=${actorId}.`,
      );

      return updated[0]!;
    });
  }

  // ──────────────────────────────────────────────────────────────────
  // Delete (admin only)
  // ──────────────────────────────────────────────────────────────────

  async deleteBankTx(db: TenantDb, id: string, actorId: string): Promise<void> {
    const bankTx = await this.findById(db, id);
    if (!bankTx) throw new BankTransactionNotFoundError(id);
    if (bankTx.status === 'matched') {
      throw new Error(
        'No se puede borrar una bank_tx matcheada. Desmatchéala primero.',
      );
    }
    await db.delete(bankTransactions).where(eq(bankTransactions.id, id));
    this.logger.warn(`BankTx ${id} BORRADA por admin=${actorId}.`);
  }
}
