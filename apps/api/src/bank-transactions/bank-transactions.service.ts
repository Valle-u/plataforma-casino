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
import {
  and,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  ne,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import {
  bankTransactions,
  deposits,
  users,
  wallets,
  walletTransactions,
  withdrawals,
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
  BankTransactionDuplicateReceiptError,
  BankTransactionDuplicateRefError,
  BankTransactionIncomingBankDataRequiredError,
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

/**
 * Con qué está conciliada una transferencia, resuelto a datos legibles.
 * Unión discriminada por `kind`. `null` = sin conciliar.
 */
export type BankTxMatchDetail =
  | {
      kind: 'manual';
      /** 'load' (carga) | 'unload' (retiro manual). */
      movementType: string;
      amount: string;
      reason: string | null;
      source: string | null;
      createdAt: Date;
      playerUsername: string | null;
      playerName: string | null;
    }
  | {
      kind: 'deposit' | 'withdrawal';
      amountChips: string;
      status: string;
      createdAt: Date;
      playerUsername: string | null;
      playerName: string | null;
    }
  | { kind: 'capital_injection'; id: string }
  | null;

export interface BankTxWithMatch extends BankTransaction {
  /** Username de quien concilió (matchedBy resuelto). */
  matchedByUsername: string | null;
  matchDetail: BankTxMatchDetail;
}

export interface ListFilters {
  status?: 'unmatched' | 'matched' | 'disputed';
  /** Sprint 51: filtrar por direction. Default sin filtro (devuelve ambos). */
  direction?: 'incoming' | 'outgoing';
  bankAccount?: string;
  amount?: string;
  dateFrom?: Date;
  dateTo?: Date;
  uploadedBy?: string;
  /** Búsqueda libre por nombre de la contraparte (quien envía/recibe). ILIKE. */
  search?: string;
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
  /**
   * Aislamiento por DUEÑO (2026-08-25, fix crítico). Reemplazan a
   * exclude/onlyBankAccounts como frontera de seguridad (que usaba un string
   * mutable). `onlyUploadedBy`: restringe a lo subido por estos users (sub-red
   * del independiente). `excludeUploadedBy`: oculta lo subido por estos users
   * (sub-redes independientes, para la vista del admin). Ver
   * `UserHierarchyService.getBankTxScope`.
   */
  onlyUploadedBy?: string[];
  excludeUploadedBy?: string[];
}

export interface BankTxRow extends BankTransaction {
  uploaderUsername: string | null;
  matchedDepositRef: string | null;
}

/** Balance agregado por cuenta propia (bankName + accountHolder). */
export interface BankAccountBalance {
  bankName: string | null;
  accountHolder: string | null;
  bankAccount: string | null;
  totalIncoming: string;
  totalOutgoing: string;
  balance: string;
  txCount: number;
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

    // Trazabilidad (2026-08-14): entrantes requieren Banco + Titular que envía.
    if (
      direction === 'incoming' &&
      (!dto.bankName?.trim() || !dto.senderName?.trim())
    ) {
      throw new BankTransactionIncomingBankDataRequiredError();
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

    // Sprint 55: dedupe por CONTENIDO del comprobante (SHA-256). El storage
    // key es un UUID random por upload — el mismo archivo subido dos veces
    // tenía dos keys distintos y pasaba el dedupe de arriba. El índice único
    // parcial sobre `receipt_hash` es el backstop contra la carrera.
    if (dto.receiptHash) {
      const dupHash = await db
        .select({ id: bankTransactions.id })
        .from(bankTransactions)
        .where(eq(bankTransactions.receiptHash, dto.receiptHash))
        .limit(1);
      if (dupHash.length > 0) {
        throw new BankTransactionDuplicateReceiptError();
      }
    }

    const inserted = await db
      .insert(bankTransactions)
      .values({
        bankAccount: dto.bankAccount ?? null,
        amount: dto.amount,
        currency: dto.currency ?? 'ARS',
        direction,
        accountHolder: dto.accountHolder ?? null,
        bankName: dto.bankName ?? null,
        senderName: dto.senderName ?? null,
        senderCbu: dto.senderCbu ?? null,
        reference: dto.reference ?? null,
        receiptUrl: dto.receiptUrl ?? null,
        receiptStorageKey: dto.receiptStorageKey ?? null,
        receiptHash: dto.receiptHash ?? null,
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
    if (filters.search && filters.search.trim() !== '') {
      conds.push(ilike(bankTransactions.senderName, `%${filters.search.trim()}%`));
    }
    if (filters.dateFrom) conds.push(sql`${bankTransactions.receivedAt} >= ${filters.dateFrom}`);
    if (filters.dateTo) conds.push(sql`${bankTransactions.receivedAt} <= ${filters.dateTo}`);
    if (filters.excludeBankAccounts && filters.excludeBankAccounts.length > 0) {
      // OJO trampa SQL: `NOT IN (...)` con bankAccount NULL da NULL (no TRUE),
      // así que excluiría las transferencias sin cuenta declarada. El form
      // simplificado no manda bankAccount → serían invisibles. Las de
      // bankAccount NULL son del admin (no de un independiente: esos siempre
      // suben con su cuenta específica), así que las incluimos explícitamente.
      conds.push(
        or(
          isNull(bankTransactions.bankAccount),
          notInArray(bankTransactions.bankAccount, filters.excludeBankAccounts),
        ),
      );
    }
    if (filters.onlyBankAccounts && filters.onlyBankAccounts.length > 0) {
      conds.push(inArray(bankTransactions.bankAccount, filters.onlyBankAccounts));
    }
    // Aislamiento por DUEÑO (fix crítico 2026-08-25). uploaded_by es NOT NULL,
    // así que notInArray no tiene la trampa del NULL de bankAccount.
    if (filters.excludeUploadedBy && filters.excludeUploadedBy.length > 0) {
      conds.push(
        notInArray(bankTransactions.uploadedBy, filters.excludeUploadedBy),
      );
    }
    if (filters.onlyUploadedBy && filters.onlyUploadedBy.length > 0) {
      conds.push(inArray(bankTransactions.uploadedBy, filters.onlyUploadedBy));
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
        accountHolder: bankTransactions.accountHolder,
        bankName: bankTransactions.bankName,
        senderName: bankTransactions.senderName,
        senderCbu: bankTransactions.senderCbu,
        reference: bankTransactions.reference,
        receiptUrl: bankTransactions.receiptUrl,
        receiptStorageKey: bankTransactions.receiptStorageKey,
        receiptHash: bankTransactions.receiptHash,
        receivedAt: bankTransactions.receivedAt,
        status: bankTransactions.status,
        uploadedBy: bankTransactions.uploadedBy,
        uploadedAt: bankTransactions.uploadedAt,
        matchedDepositId: bankTransactions.matchedDepositId,
        matchedWithdrawalId: bankTransactions.matchedWithdrawalId,
        matchedCapitalInjectionId: bankTransactions.matchedCapitalInjectionId,
        matchedManualTxId: bankTransactions.matchedManualTxId,
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

  /**
   * Balance por cuenta propia (bankName + accountHolder): suma entrantes −
   * salientes de TODAS las transferencias cargadas (matched + unmatched —
   * decisión dueño 2026-08-14: refleja todo lo subido al sistema, aunque no
   * esté conciliado todavía). Excluye `disputed` (transferencias en
   * cuestionamiento, no deberían sumar al balance hasta resolverse).
   *
   * Respeta el mismo aislamiento que `list()`: el admin no ve las cuentas de
   * socios independientes y viceversa.
   */
  async getBalances(
    db: TenantDb,
    opts: {
      excludeBankAccounts?: string[];
      onlyBankAccounts?: string[];
      onlyUploadedBy?: string[];
      excludeUploadedBy?: string[];
    } = {},
  ): Promise<BankAccountBalance[]> {
    const conds = [];
    conds.push(ne(bankTransactions.status, 'disputed'));
    if (opts.excludeBankAccounts && opts.excludeBankAccounts.length > 0) {
      conds.push(
        or(
          isNull(bankTransactions.bankAccount),
          notInArray(bankTransactions.bankAccount, opts.excludeBankAccounts),
        ),
      );
    }
    if (opts.onlyBankAccounts && opts.onlyBankAccounts.length > 0) {
      conds.push(inArray(bankTransactions.bankAccount, opts.onlyBankAccounts));
    }
    // Aislamiento por DUEÑO (fix crítico 2026-08-25).
    if (opts.excludeUploadedBy && opts.excludeUploadedBy.length > 0) {
      conds.push(
        notInArray(bankTransactions.uploadedBy, opts.excludeUploadedBy),
      );
    }
    if (opts.onlyUploadedBy && opts.onlyUploadedBy.length > 0) {
      conds.push(inArray(bankTransactions.uploadedBy, opts.onlyUploadedBy));
    }

    const rows = await db
      .select({
        bankName: bankTransactions.bankName,
        accountHolder: bankTransactions.accountHolder,
        bankAccount: sql<string | null>`MAX(${bankTransactions.bankAccount})`,
        totalIncoming: sql<string>`COALESCE(SUM(CASE WHEN ${bankTransactions.direction} = 'incoming' THEN ${bankTransactions.amount} ELSE 0 END), 0)::text`,
        totalOutgoing: sql<string>`COALESCE(SUM(CASE WHEN ${bankTransactions.direction} = 'outgoing' THEN ${bankTransactions.amount} ELSE 0 END), 0)::text`,
        txCount: sql<number>`COUNT(*)::int`,
      })
      .from(bankTransactions)
      .where(and(...conds))
      .groupBy(bankTransactions.bankName, bankTransactions.accountHolder)
      .orderBy(bankTransactions.bankName, bankTransactions.accountHolder);

    return rows.map((r) => ({
      bankName: r.bankName,
      accountHolder: r.accountHolder,
      bankAccount: r.bankAccount,
      totalIncoming: r.totalIncoming,
      totalOutgoing: r.totalOutgoing,
      balance: (Number(r.totalIncoming) - Number(r.totalOutgoing)).toFixed(2),
      txCount: r.txCount,
    }));
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
   * Detalle enriquecido de una transferencia: la fila + con QUÉ está
   * conciliada (carga/retiro manual, depósito o retiro), resuelto a datos
   * legibles (monto, jugador, fecha, motivo) + quién la matcheó.
   * Read-only, para el drawer de detalle en Transferencias.
   */
  async getDetail(db: TenantDb, id: string): Promise<BankTxWithMatch | null> {
    const row = await this.findById(db, id);
    if (!row) return null;

    let matchedByUsername: string | null = null;
    if (row.matchedBy) {
      const u = await db
        .select({ username: users.username })
        .from(users)
        .where(eq(users.id, row.matchedBy))
        .limit(1);
      matchedByUsername = u[0]?.username ?? null;
    }

    return {
      ...row,
      matchedByUsername,
      matchDetail: await this.resolveMatchDetail(db, row),
    };
  }

  private async resolveMatchDetail(
    db: TenantDb,
    row: BankTransaction,
  ): Promise<BankTxMatchDetail> {
    if (row.matchedManualTxId) {
      const r = await db
        .select({
          type: walletTransactions.type,
          amount: walletTransactions.amount,
          reason: walletTransactions.reason,
          source: walletTransactions.source,
          createdAt: walletTransactions.createdAt,
          playerUsername: users.username,
          playerName: users.displayName,
        })
        .from(walletTransactions)
        .leftJoin(wallets, eq(wallets.id, walletTransactions.walletId))
        .leftJoin(users, eq(users.id, wallets.userId))
        .where(eq(walletTransactions.id, row.matchedManualTxId))
        .limit(1);
      const m = r[0];
      if (!m) return null;
      return {
        kind: 'manual',
        movementType: m.type,
        amount: m.amount,
        reason: m.reason,
        source: m.source,
        createdAt: m.createdAt,
        playerUsername: m.playerUsername,
        playerName: m.playerName,
      };
    }
    if (row.matchedDepositId) {
      const r = await db
        .select({
          amountChips: deposits.amountChips,
          status: deposits.status,
          createdAt: deposits.createdAt,
          playerUsername: users.username,
          playerName: users.displayName,
        })
        .from(deposits)
        .leftJoin(users, eq(users.id, deposits.userId))
        .where(eq(deposits.id, row.matchedDepositId))
        .limit(1);
      const d = r[0];
      if (!d) return null;
      return {
        kind: 'deposit',
        amountChips: d.amountChips,
        status: d.status,
        createdAt: d.createdAt,
        playerUsername: d.playerUsername,
        playerName: d.playerName,
      };
    }
    if (row.matchedWithdrawalId) {
      const r = await db
        .select({
          amountChips: withdrawals.amountChips,
          status: withdrawals.status,
          createdAt: withdrawals.createdAt,
          playerUsername: users.username,
          playerName: users.displayName,
        })
        .from(withdrawals)
        .leftJoin(users, eq(users.id, withdrawals.userId))
        .where(eq(withdrawals.id, row.matchedWithdrawalId))
        .limit(1);
      const w = r[0];
      if (!w) return null;
      return {
        kind: 'withdrawal',
        amountChips: w.amountChips,
        status: w.status,
        createdAt: w.createdAt,
        playerUsername: w.playerUsername,
        playerName: w.playerName,
      };
    }
    if (row.matchedCapitalInjectionId) {
      return { kind: 'capital_injection', id: row.matchedCapitalInjectionId };
    }
    return null;
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
    scope?: { onlyUploadedBy?: string[]; excludeUploadedBy?: string[] },
  ): Promise<BankTransaction[]> {
    const conds = [eq(bankTransactions.status, 'unmatched')];
    if (direction) conds.push(eq(bankTransactions.direction, direction));
    // Aislamiento por DUEÑO (fix crítico 2026-08-25): el indep solo ve lo que
    // subió su sub-red; el admin, todo menos las sub-redes independientes.
    if (scope?.onlyUploadedBy && scope.onlyUploadedBy.length > 0) {
      conds.push(inArray(bankTransactions.uploadedBy, scope.onlyUploadedBy));
    }
    if (scope?.excludeUploadedBy && scope.excludeUploadedBy.length > 0) {
      conds.push(
        notInArray(bankTransactions.uploadedBy, scope.excludeUploadedBy),
      );
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
    scope?: { onlyUploadedBy?: string[]; excludeUploadedBy?: string[] },
  ): Promise<BankTransaction[]> {
    const conds = [
      eq(bankTransactions.status, 'unmatched'),
      eq(bankTransactions.amount, amount),
      eq(bankTransactions.direction, direction),
    ];
    if (scope?.onlyUploadedBy && scope.onlyUploadedBy.length > 0) {
      conds.push(inArray(bankTransactions.uploadedBy, scope.onlyUploadedBy));
    }
    if (scope?.excludeUploadedBy && scope.excludeUploadedBy.length > 0) {
      conds.push(
        notInArray(bankTransactions.uploadedBy, scope.excludeUploadedBy),
      );
    }
    return db
      .select()
      .from(bankTransactions)
      .where(and(...conds))
      .orderBy(desc(bankTransactions.receivedAt))
      .limit(20);
  }

  /**
   * Aislamiento por DUEÑO (2026-08-25, fix crítico): verifica que la bank_tx
   * `id` caiga en el scope del actor por `uploaded_by` (INMUTABLE), no por el
   * `bankAccount` (string mutable que permitía reclamar la cuenta ajena). Si no
   * cae en scope → NOT_FOUND (404, no revela existencia).
   *   - `onlyUploadedBy`: la subió alguien de la sub-red del indep.
   *   - `excludeUploadedBy`: NO la subió una sub-red independiente (vista admin).
   *
   * Uso: match/unmatch/update/delete/findById tocables por un actor con
   * bank_tx.*. Ver `getBankTxScope`.
   */
  async assertBankTxUploadedByScope(
    db: TenantDb,
    id: string,
    scope: { onlyUploadedBy?: string[]; excludeUploadedBy?: string[] },
  ): Promise<BankTransaction> {
    const row = await this.findById(db, id);
    if (!row) throw new BankTransactionNotFoundError(id);
    if (scope.onlyUploadedBy && !scope.onlyUploadedBy.includes(row.uploadedBy)) {
      throw new BankTransactionNotFoundError(id);
    }
    if (scope.excludeUploadedBy && scope.excludeUploadedBy.includes(row.uploadedBy)) {
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
   * Concilia una bank_tx con una CARGA/RETIRO de fichas MANUAL — un
   * wallet_transaction type 'load' (para incoming) o 'unload' (outgoing). A
   * diferencia de deposits/withdrawals, el movimiento manual NO tiene fila de
   * dominio y es append-only (E2) → el vínculo vive SOLO del lado de la bank_tx
   * (matched_manual_tx_id). El índice único garantiza 1 movimiento ↔ 1 bank_tx.
   *
   * Reglas:
   *   - bank_tx 'unmatched'; direction incoming↔'load', outgoing↔'unload'.
   *   - el wallet_tx debe ser del type esperado y no estar ya conciliado.
   *   - monto exacto (fichas = pesos, E1) u override con motivo (≥5 chars).
   */
  async matchManual(
    db: TenantDb,
    bankTxId: string,
    walletTxId: string,
    actorId: string,
    dto: MatchBankTransactionDto,
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
      if (bankTx.status === 'matched') {
        throw new BankTransactionAlreadyMatchedError(
          bankTxId,
          bankTx.matchedManualTxId ?? bankTx.matchedDepositId ?? 'unknown',
        );
      }

      // El movimiento manual (append-only → no se lockea).
      const wtRows = await tx
        .select({
          id: walletTransactions.id,
          type: walletTransactions.type,
          amount: walletTransactions.amount,
        })
        .from(walletTransactions)
        .where(eq(walletTransactions.id, walletTxId))
        .limit(1);
      const wt = wtRows[0];
      if (!wt) throw new Error(`Movimiento ${walletTxId} no existe.`);

      const expectedType = bankTx.direction === 'incoming' ? 'load' : 'unload';
      if (wt.type !== expectedType) {
        throw new Error(
          `La transferencia es '${bankTx.direction}' → debe conciliarse con un movimiento '${expectedType}', no '${wt.type}'.`,
        );
      }

      // ¿Ya conciliado? (el índice único es el backstop; esto da mejor error).
      const already = await tx
        .select({ id: bankTransactions.id })
        .from(bankTransactions)
        .where(eq(bankTransactions.matchedManualTxId, walletTxId))
        .limit(1);
      if (already[0]) {
        throw new Error(
          `El movimiento ${walletTxId} ya está conciliado con otra transferencia.`,
        );
      }

      const amountsMatch = Number(bankTx.amount) === Number(wt.amount);
      if (!amountsMatch && !dto.override) {
        throw new BankTransactionAmountMismatchError(bankTx.amount, wt.amount);
      }
      if (
        !amountsMatch &&
        dto.override &&
        (!dto.overrideReason || dto.overrideReason.length < 5)
      ) {
        throw new Error(
          'overrideReason requerido (≥5 chars) cuando los montos no coinciden.',
        );
      }

      const now = new Date();
      const updated = await tx
        .update(bankTransactions)
        .set({
          status: 'matched',
          matchedManualTxId: walletTxId,
          matchedBy: actorId,
          matchedAt: now,
          overrideReason: !amountsMatch ? dto.overrideReason : null,
          updatedAt: now,
        })
        .where(eq(bankTransactions.id, bankTxId))
        .returning();

      this.logger.log(
        `BankTx ${bankTxId} matched con movimiento manual ${walletTxId} (${wt.type}) por user=${actorId}${
          dto.override ? ` (OVERRIDE: ${dto.overrideReason})` : ''
        }.`,
      );
      return updated[0]!;
    });
  }

  /**
   * Lista cargas ('load' → conciliar con incoming) o retiros ('unload' →
   * outgoing) MANUALES que todavía NO están conciliados con ninguna bank_tx.
   * Candidatos para el match. Filtros: importe exacto, búsqueda por titular.
   */
  async listUnmatchedManual(
    db: TenantDb,
    direction: 'incoming' | 'outgoing',
    filters: { amount?: string; search?: string; limit?: number } = {},
  ): Promise<
    Array<{
      id: string;
      amount: string;
      createdAt: Date;
      reason: string | null;
      ownerUsername: string;
      ownerDisplayName: string;
    }>
  > {
    const type = direction === 'incoming' ? 'load' : 'unload';
    const conds = [
      eq(walletTransactions.type, type),
      sql`NOT EXISTS (
        SELECT 1 FROM ${bankTransactions} b
        WHERE b.matched_manual_tx_id = ${walletTransactions.id}
      )`,
    ];
    if (filters.amount) {
      conds.push(eq(walletTransactions.amount, filters.amount));
    }
    if (filters.search && filters.search.trim() !== '') {
      const like = `%${filters.search.trim()}%`;
      conds.push(
        sql`(${users.username} ILIKE ${like} OR ${users.displayName} ILIKE ${like})`,
      );
    }
    const limit = Math.min(filters.limit ?? 30, 100);
    return db
      .select({
        id: walletTransactions.id,
        amount: walletTransactions.amount,
        createdAt: walletTransactions.createdAt,
        reason: walletTransactions.reason,
        ownerUsername: users.username,
        ownerDisplayName: users.displayName,
      })
      .from(walletTransactions)
      .innerJoin(wallets, eq(wallets.id, walletTransactions.walletId))
      .innerJoin(users, eq(users.id, wallets.userId))
      .where(and(...conds))
      .orderBy(desc(walletTransactions.createdAt))
      .limit(limit);
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
          matchedManualTxId: null,
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

      // Sprint 55: mismo re-chequeo por contenido (SHA-256). Si cambia el
      // comprobante, el nuevo archivo no puede estar ya en otra tx.
      const nextReceiptHash =
        dto.receiptHash !== undefined
          ? dto.receiptHash || null
          : bankTx.receiptHash;
      if (nextReceiptHash && dto.receiptHash !== undefined) {
        const dupHash = await tx
          .select({ id: bankTransactions.id })
          .from(bankTransactions)
          .where(
            and(
              eq(bankTransactions.receiptHash, nextReceiptHash),
              ne(bankTransactions.id, id),
            ),
          )
          .limit(1);
        if (dupHash.length > 0) {
          throw new BankTransactionDuplicateReceiptError();
        }
      }

      const patch: Partial<typeof bankTransactions.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (dto.bankAccount !== undefined) patch.bankAccount = dto.bankAccount;
      if (dto.amount !== undefined) patch.amount = dto.amount;
      if (dto.direction !== undefined) patch.direction = dto.direction;
      if (dto.currency !== undefined) patch.currency = dto.currency || 'ARS';
      if (dto.accountHolder !== undefined)
        patch.accountHolder = dto.accountHolder || null;
      if (dto.bankName !== undefined) patch.bankName = dto.bankName || null;
      if (dto.senderName !== undefined) patch.senderName = dto.senderName || null;
      if (dto.senderCbu !== undefined) patch.senderCbu = dto.senderCbu || null;
      if (dto.reference !== undefined) patch.reference = dto.reference || null;
      if (dto.receiptUrl !== undefined) patch.receiptUrl = dto.receiptUrl || null;
      if (dto.receiptStorageKey !== undefined)
        patch.receiptStorageKey = dto.receiptStorageKey || null;
      if (dto.receiptHash !== undefined) patch.receiptHash = dto.receiptHash || null;
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
