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
import { and, desc, eq, inArray, ne, notInArray, sql } from 'drizzle-orm';
import {
  bankTransactions,
  deposits,
  users,
  type BankTransaction,
} from '@casino/db';
import { ActorRoleService } from '../common/actor-role.service';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import {
  BANK_TX_UPLOAD_RATE_MAX_AMOUNT,
  BANK_TX_UPLOAD_RATE_MAX_COUNT,
  BANK_TX_UPLOAD_RATE_WINDOW_SEC,
} from './bank-transactions.constants';
import {
  BankTransactionAlreadyMatchedError,
  BankTransactionAmountMismatchError,
  BankTransactionDuplicateRefError,
  BankTransactionMatchedImmutableError,
  BankTransactionNotFoundError,
  BankTransactionOutgoingReceiptRequiredError,
  BankTransactionUploadRateLimitedError,
  DepositAlreadyHasBankTxError,
} from './bank-transactions.errors';
import type {
  UpdateBankTransactionDto,
  UploadBankTransactionDto,
  MatchBankTransactionDto,
} from './dto/upload-bank-tx.dto';

export interface ListFilters {
  status?: 'unmatched' | 'matched' | 'disputed';
  /** Sprint 51: filtrar por direction. Default sin filtro (devuelve ambos). */
  direction?: 'incoming' | 'outgoing';
  bankAccount?: string;
  amount?: string;
  dateFrom?: Date;
  dateTo?: Date;
  uploadedBy?: string;
  limit?: number;
  offset?: number;
  /**
   * Cuentas bancarias a EXCLUIR del listado. Se usa para ocultar al admin
   * las transferencias que caen en cuentas propias de socios independientes
   * (`users.branchBankAccount`) — modelo económico: el independiente tiene
   * su propio banco, ese extracto no le corresponde al admin.
   */
  excludeBankAccounts?: string[];
  /**
   * Capa 3 · Fase 2: cuentas bancarias que el actor está autorizado a ver.
   * Si viene, el listado se RESTRINGE a estas cuentas (opuesto simétrico
   * de `excludeBankAccounts`). Usado por el socio independiente: solo
   * ve movimientos de su propia `branchBankAccount`.
   */
  onlyBankAccounts?: string[];
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

  constructor(private readonly actorRole: ActorRoleService) {}

  // ──────────────────────────────────────────────────────────────────
  // Upload (empleado de confianza)
  // ──────────────────────────────────────────────────────────────────

  /**
   * D2-light: throttle soft por actor sobre uploads en la última hora.
   * Mide cantidad y monto acumulado directamente en `bank_transactions`
   * (no usa el `RateLimiterService` in-memory porque el criterio es
   * transaccional y sobrevive a reinicios del proceso). Bypass explícito
   * para `admin_tenant` — el admin puede necesitar cargar lotes al hacer
   * conciliación manual.
   *
   * Devuelve `null` si está OK, o tira `BankTransactionUploadRateLimitedError`
   * si supera un umbral. Se ejecuta ANTES del insert, así el intento
   * bloqueado no cuenta contra la ventana.
   */
  async assertUploadRate(
    db: TenantDb,
    actorId: string,
    incomingAmount: string,
  ): Promise<void> {
    const isAdmin = await this.actorRole.isAdminTenant(db, actorId);
    if (isAdmin) return;

    // Ventana: uploaded_at > now() - windowSec. Usamos raw SQL para
    // aprovechar el índice sobre uploaded_at + uploaded_by y evitar
    // el overhead de dos queries separadas.
    const windowSec = BANK_TX_UPLOAD_RATE_WINDOW_SEC;
    const result = await db.execute(sql`
      SELECT COUNT(*)::int AS cnt,
             COALESCE(SUM(amount), 0)::numeric AS total
      FROM bank_transactions
      WHERE uploaded_by = ${actorId}
        AND uploaded_at > NOW() - (${windowSec} || ' seconds')::interval
    `);
    type Row = { cnt: number; total: string };
    const row: Row | undefined =
      (result as unknown as { rows?: Row[] }).rows?.[0]
      ?? (result as unknown as Row[])[0];
    const count = Number(row?.cnt ?? 0);
    const total = Number(row?.total ?? 0);

    if (count >= BANK_TX_UPLOAD_RATE_MAX_COUNT) {
      throw new BankTransactionUploadRateLimitedError(
        'count',
        count,
        BANK_TX_UPLOAD_RATE_MAX_COUNT,
      );
    }
    const projectedTotal = total + Number(incomingAmount);
    if (projectedTotal > BANK_TX_UPLOAD_RATE_MAX_AMOUNT) {
      throw new BankTransactionUploadRateLimitedError(
        'amount',
        Math.round(projectedTotal),
        BANK_TX_UPLOAD_RATE_MAX_AMOUNT,
      );
    }
  }

  /**
   * Carga una nueva bank_transaction. Si `receiptStorageKey` está presente,
   * verifica duplicado (mismo comprobante) y tira 409 si ya existe
   * (UNIQUE index lo enforce a nivel DB, pero queremos mensaje amigable).
   *
   * Sprint 52: para `direction='outgoing'` el comprobante es OBLIGATORIO —
   * es la prueba de que la transferencia saliente se ejecutó. Reemplaza a
   * la referencia bancaria manual (campo eliminado).
   *
   * D2-light: antes del insert, aplica el throttle por actor (skip para
   * admin_tenant). El controller mapea el error a 429.
   */
  async upload(
    db: TenantDb,
    actorId: string,
    dto: UploadBankTransactionDto,
  ): Promise<BankTransaction> {
    // D2-light: throttle soft por actor (skip admin_tenant).
    await this.assertUploadRate(db, actorId, dto.amount);

    const direction = dto.direction ?? 'incoming';

    // Sprint 52: comprobante obligatorio para salientes.
    if (direction === 'outgoing' && !dto.receiptStorageKey) {
      throw new BankTransactionOutgoingReceiptRequiredError();
    }

    // Pre-check idempotencia por comprobante.
    if (dto.receiptStorageKey) {
      const existing = await db
        .select({ id: bankTransactions.id })
        .from(bankTransactions)
        .where(eq(bankTransactions.receiptStorageKey, dto.receiptStorageKey))
        .limit(1);
      if (existing.length > 0) {
        throw new BankTransactionDuplicateRefError(dto.receiptStorageKey);
      }
    }

    const inserted = await db
      .insert(bankTransactions)
      .values({
        bankAccount: dto.bankAccount ?? null,
        amount: dto.amount,
        currency: dto.currency ?? 'ARS',
        direction,
        senderName: dto.senderName ?? null,
        senderCbu: dto.senderCbu ?? null,
        reference: dto.reference ?? null,
        receiptUrl: dto.receiptUrl ?? null,
        receiptStorageKey: dto.receiptStorageKey ?? null,
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
    if (filters.direction) conds.push(eq(bankTransactions.direction, filters.direction));
    if (filters.bankAccount) conds.push(eq(bankTransactions.bankAccount, filters.bankAccount));
    if (filters.amount) conds.push(eq(bankTransactions.amount, filters.amount));
    if (filters.uploadedBy) conds.push(eq(bankTransactions.uploadedBy, filters.uploadedBy));
    if (filters.dateFrom) conds.push(sql`${bankTransactions.receivedAt} >= ${filters.dateFrom}`);
    if (filters.dateTo) conds.push(sql`${bankTransactions.receivedAt} <= ${filters.dateTo}`);
    if (filters.excludeBankAccounts && filters.excludeBankAccounts.length > 0) {
      conds.push(notInArray(bankTransactions.bankAccount, filters.excludeBankAccounts));
    }
    if (filters.onlyBankAccounts && filters.onlyBankAccounts.length > 0) {
      conds.push(inArray(bankTransactions.bankAccount, filters.onlyBankAccounts));
    }
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
        direction: bankTransactions.direction,
        senderName: bankTransactions.senderName,
        senderCbu: bankTransactions.senderCbu,
        reference: bankTransactions.reference,
        receiptUrl: bankTransactions.receiptUrl,
        receiptStorageKey: bankTransactions.receiptStorageKey,
        receivedAt: bankTransactions.receivedAt,
        status: bankTransactions.status,
        uploadedBy: bankTransactions.uploadedBy,
        uploadedAt: bankTransactions.uploadedAt,
        matchedDepositId: bankTransactions.matchedDepositId,
        matchedWithdrawalId: bankTransactions.matchedWithdrawalId,
        matchedCapitalInjectionId: bankTransactions.matchedCapitalInjectionId,
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
   * Sprint 51: ahora filtra por direction opcional.
   */
  async findAllUnmatched(
    db: TenantDb,
    direction?: 'incoming' | 'outgoing',
    onlyBankAccounts?: string[],
  ): Promise<BankTransaction[]> {
    const conds = [eq(bankTransactions.status, 'unmatched')];
    if (direction) conds.push(eq(bankTransactions.direction, direction));
    // Capa 3 · Fase 2: si el actor es indep, filtramos por su cuenta para
    // que el selector de matching no le muestre bank_txs del admin/otros.
    if (onlyBankAccounts && onlyBankAccounts.length > 0) {
      conds.push(inArray(bankTransactions.bankAccount, onlyBankAccounts));
    }
    return db
      .select()
      .from(bankTransactions)
      .where(and(...conds))
      .orderBy(desc(bankTransactions.receivedAt))
      .limit(50);
  }

  /**
   * Sprint 51: filtra unmatched por monto exacto Y direction. Sirve para
   * el selector "matchear este deposit/withdrawal con qué bank_tx".
   */
  async findUnmatchedByAmountAndDirection(
    db: TenantDb,
    amount: string,
    direction: 'incoming' | 'outgoing',
    onlyBankAccounts?: string[],
  ): Promise<BankTransaction[]> {
    const conds = [
      eq(bankTransactions.status, 'unmatched'),
      eq(bankTransactions.amount, amount),
      eq(bankTransactions.direction, direction),
    ];
    if (onlyBankAccounts && onlyBankAccounts.length > 0) {
      conds.push(inArray(bankTransactions.bankAccount, onlyBankAccounts));
    }
    return db
      .select()
      .from(bankTransactions)
      .where(and(...conds))
      .orderBy(desc(bankTransactions.receivedAt))
      .limit(20);
  }

  /**
   * Capa 3 · Fase 2: verifica que la bank_tx `id` pertenezca a alguna de
   * las cuentas permitidas. Si el actor es indep, se pasa su propia cuenta;
   * si no matchea, se devuelve NOT_FOUND (404) para no revelar existencia.
   *
   * Uso: match/unmatch/update/delete/findById de los endpoints tocables
   * por un socio indep con perm bank_tx.*. El admin nunca pasa por acá
   * (skip explícito arriba).
   */
  async assertBankTxOwnedByAccount(
    db: TenantDb,
    id: string,
    allowedBankAccounts: string[],
  ): Promise<BankTransaction> {
    const row = await this.findById(db, id);
    if (!row) throw new BankTransactionNotFoundError(id);
    // Sprint 53: una bank_tx sin cuenta declarada nunca es de un indep.
    if (row.bankAccount === null || !allowedBankAccounts.includes(row.bankAccount)) {
      // Mismo trato que Fase 1 (bonus_definitions): 404, no 403.
      throw new BankTransactionNotFoundError(id);
    }
    return row;
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
   * Sprint 51: matchea una bank_tx OUTGOING con un withdrawal. Atómico.
   *
   * Reglas:
   *   - bank_tx debe estar 'unmatched' y direction='outgoing'.
   *   - withdrawal debe estar 'approved' (cajero ya autorizó, ahora
   *     falta confirmar pago externo).
   *   - withdrawal NO debe tener ya una bank_tx asociada.
   *   - Match exacto del monto o override con motivo (≥5 chars).
   */
  async matchWithdrawal(
    db: TenantDb,
    bankTxId: string,
    withdrawalId: string,
    actorId: string,
    dto: MatchBankTransactionDto,
  ): Promise<BankTransaction> {
    return db.transaction(async (tx) => {
      // Lock bank_tx.
      const bankTxRows = await tx
        .select()
        .from(bankTransactions)
        .where(eq(bankTransactions.id, bankTxId))
        .for('update')
        .limit(1);
      const bankTx = bankTxRows[0];
      if (!bankTx) throw new BankTransactionNotFoundError(bankTxId);

      if (bankTx.direction !== 'outgoing') {
        throw new Error(
          `Bank tx ${bankTxId} es 'incoming' — se usa para deposits, no para retiros.`,
        );
      }
      if (bankTx.status === 'matched') {
        throw new BankTransactionAlreadyMatchedError(
          bankTxId,
          bankTx.matchedWithdrawalId ?? 'unknown',
        );
      }

      // Lock withdrawal — usamos SQL raw porque withdrawals no está
      // importada acá (FK circular evitada). El driver postgres-js devuelve
      // un array directo; pg-node lo wrappea en `{ rows: [...] }` — manejamos
      // ambos shapes igual que en wallet.service.ts.
      const wdRowsRaw = await tx.execute(
        sql`SELECT id, amount_chips, amount_fiat, bank_transaction_id, status
            FROM withdrawals WHERE id = ${withdrawalId} FOR UPDATE`,
      );
      type WdRow = {
        id: string;
        amount_chips: string;
        amount_fiat: string;
        bank_transaction_id: string | null;
        status: string;
      };
      const wd: WdRow | undefined =
        (wdRowsRaw as unknown as { rows: WdRow[] }).rows?.[0]
        ?? (wdRowsRaw as unknown as WdRow[])[0];
      if (!wd) throw new Error(`Withdrawal ${withdrawalId} no existe.`);

      if (wd.bank_transaction_id) {
        throw new Error(
          `Withdrawal ${withdrawalId} ya tiene transferencia bancaria asociada.`,
        );
      }
      if (wd.status !== 'approved' && wd.status !== 'processing') {
        throw new Error(
          `Withdrawal ${withdrawalId} en status '${wd.status}' — debe estar approved/processing para matchear.`,
        );
      }

      // Validar monto exacto si no override. La bank_tx es plata real
      // (fiat), por eso comparamos contra amount_fiat del retiro.
      const amountsMatch = Number(bankTx.amount) === Number(wd.amount_fiat);
      if (!amountsMatch && !dto.override) {
        throw new BankTransactionAmountMismatchError(bankTx.amount, wd.amount_fiat);
      }
      if (!amountsMatch && dto.override && (!dto.overrideReason || dto.overrideReason.length < 5)) {
        throw new Error('overrideReason requerido (≥5 chars) cuando los montos no coinciden.');
      }

      const now = new Date();

      const updatedBankTx = await tx
        .update(bankTransactions)
        .set({
          status: 'matched',
          matchedWithdrawalId: withdrawalId,
          matchedBy: actorId,
          matchedAt: now,
          overrideReason: !amountsMatch ? dto.overrideReason : null,
          updatedAt: now,
        })
        .where(eq(bankTransactions.id, bankTxId))
        .returning();

      // Linkear backward en withdrawal via SQL raw.
      await tx.execute(
        sql`UPDATE withdrawals SET bank_transaction_id = ${bankTxId}, updated_at = NOW()
            WHERE id = ${withdrawalId}`,
      );

      this.logger.log(
        `BankTx ${bankTxId} matched con withdrawal ${withdrawalId} por user=${actorId}${
          dto.override ? ` (OVERRIDE: ${dto.overrideReason})` : ''
        }.`,
      );

      return updatedBankTx[0]!;
    });
  }

  /**
   * Revierte un match. Solo permitido si:
   *   - Para incoming: el deposit aún no fue aprobado.
   *   - Para outgoing: el withdrawal aún no fue marcado paid.
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

      if (bankTx.status !== 'matched') {
        throw new Error('La bank_tx no está matcheada.');
      }

      const now = new Date();

      if (bankTx.direction === 'incoming' && bankTx.matchedDepositId) {
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
        if (dep) {
          await tx
            .update(deposits)
            .set({ bankTransactionId: null, updatedAt: now })
            .where(eq(deposits.id, dep.id));
        }
      } else if (bankTx.direction === 'outgoing' && bankTx.matchedWithdrawalId) {
        // Verificar que el withdrawal no esté paid.
        const wdResultRaw = await tx.execute(
          sql`SELECT id, status FROM withdrawals WHERE id = ${bankTx.matchedWithdrawalId}`,
        );
        type WdStatusRow = { id: string; status: string };
        const wd: WdStatusRow | undefined =
          (wdResultRaw as unknown as { rows: WdStatusRow[] }).rows?.[0]
          ?? (wdResultRaw as unknown as WdStatusRow[])[0];
        if (wd && wd.status === 'paid') {
          throw new Error(
            `No se puede desmatchear: el withdrawal ${wd.id} ya fue marcado paid.`,
          );
        }
        if (wd) {
          await tx.execute(
            sql`UPDATE withdrawals SET bank_transaction_id = NULL, updated_at = NOW()
                WHERE id = ${wd.id}`,
          );
        }
      }

      const updated = await tx
        .update(bankTransactions)
        .set({
          status: 'unmatched',
          matchedDepositId: null,
          matchedWithdrawalId: null,
          matchedBy: null,
          matchedAt: null,
          overrideReason: null,
          updatedAt: now,
        })
        .where(eq(bankTransactions.id, bankTxId))
        .returning();

      this.logger.log(`BankTx ${bankTxId} unmatched por user=${actorId}.`);
      return updated[0]!;
    });
  }

  // ──────────────────────────────────────────────────────────────────
  // Edit (solo unmatched)
  // ──────────────────────────────────────────────────────────────────

   /**
    * Edita una transferencia AÚN sin matchear. Patch parcial: solo se tocan
    * los campos presentes en el DTO. Rechaza si ya está matcheada (esos datos
    * respaldan un deposit/withdrawal y no deben mutarse). Re-chequea el
    * duplicado por comprobante (receipt_storage_key) si cambia.
    *
    * Lockea la fila (FOR UPDATE) para no pisar un match concurrente.
    */
  async update(
    db: TenantDb,
    id: string,
    actorId: string,
    dto: UpdateBankTransactionDto,
  ): Promise<BankTransaction> {
    return db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(bankTransactions)
        .where(eq(bankTransactions.id, id))
        .for('update')
        .limit(1);
      const bankTx = rows[0];
      if (!bankTx) throw new BankTransactionNotFoundError(id);
      if (bankTx.status === 'matched') {
        throw new BankTransactionMatchedImmutableError(id, 'editar');
      }

      // Re-chequeo de duplicado si cambia el comprobante.
      const nextReceiptKey =
        dto.receiptStorageKey !== undefined
          ? dto.receiptStorageKey || null
          : bankTx.receiptStorageKey;
      if (nextReceiptKey && dto.receiptStorageKey !== undefined) {
        const dup = await tx
          .select({ id: bankTransactions.id })
          .from(bankTransactions)
          .where(
            and(
              eq(bankTransactions.receiptStorageKey, nextReceiptKey),
              ne(bankTransactions.id, id),
            ),
          )
          .limit(1);
        if (dup.length > 0) {
          throw new BankTransactionDuplicateRefError(nextReceiptKey);
        }
      }

      const patch: Partial<typeof bankTransactions.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (dto.bankAccount !== undefined) patch.bankAccount = dto.bankAccount;
      if (dto.amount !== undefined) patch.amount = dto.amount;
      if (dto.direction !== undefined) patch.direction = dto.direction;
      if (dto.currency !== undefined) patch.currency = dto.currency || 'ARS';
      if (dto.senderName !== undefined) patch.senderName = dto.senderName || null;
      if (dto.senderCbu !== undefined) patch.senderCbu = dto.senderCbu || null;
      if (dto.reference !== undefined) patch.reference = dto.reference || null;
      if (dto.receiptUrl !== undefined) patch.receiptUrl = dto.receiptUrl || null;
      if (dto.receiptStorageKey !== undefined)
        patch.receiptStorageKey = dto.receiptStorageKey || null;
      if (dto.receivedAt !== undefined)
        patch.receivedAt = new Date(dto.receivedAt);
      if (dto.notes !== undefined) patch.notes = dto.notes || null;

      const updated = await tx
        .update(bankTransactions)
        .set(patch)
        .where(eq(bankTransactions.id, id))
        .returning();

      this.logger.log(`BankTx ${id} editada por user=${actorId}.`);
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
      throw new BankTransactionMatchedImmutableError(id, 'borrar');
    }
    await db.delete(bankTransactions).where(eq(bankTransactions.id, id));
    this.logger.warn(`BankTx ${id} BORRADA por admin=${actorId}.`);
  }
}
