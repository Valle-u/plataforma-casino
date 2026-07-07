/**
 * LedgerReconciliationService — el "validador de invariante" del ledger.
 *
 * Blindaje del núcleo económico (pre-v1), Parte A. Ver docs/14-roadmap.md §10.6.
 *
 * Chequea que las fichas CUADREN contra el ledger inmutable
 * `wallet_transactions`, que es la única fuente de verdad del dinero:
 *
 *   1. Integridad de balance: para cada wallet,
 *        `wallets.balance == Σ(créditos) − Σ(débitos)`
 *      (misma clasificación crédito/débito que usa WalletService al escribir
 *      `balance_after`, así el chequeo refleja exactamente la lógica real).
 *      `rollback` es neutral (no mueve saldo). `adjustment` es CRÉDITO: es el
 *      lado target de las cargas por corrección de empleado (Casa → jugador),
 *      que `executeTransferPair` acredita (+amount) aunque `directionFor` lo
 *      etiquete neutral. Contarlo como crédito es lo que hace que `balance ==
 *      Σtx` cierre; si no, cada corrección dispara un descuadre falso
 *      (auditoría economía 2026-07).
 *
 *   2. Integridad de holds: para cada wallet,
 *        `wallets.locked_balance == Σ(holds activos)`  (released_at IS NULL).
 *
 *   3. Snapshot de supply: minteado / quemado / depositado / retirado /
 *      ganado / apostado / comisiones + en circulación + bloqueado. Base
 *      para la futura reconciliación con respaldo real (Parte B).
 *
 * Política (decidida 2026-06-29): ante un descuadre **solo alerta** — persiste
 * la corrida con `status='mismatch'` y escribe un `audit_log` severity high.
 * NO bloquea operaciones (un falso positivo no debe frenar el casino).
 *
 * Cada corrida se persiste en `ledger_reconciliation_runs` (append-only) para
 * el historial del panel. Es read-only sobre la economía: lo único que escribe
 * es su propia fila de corrida + el audit del aviso.
 */

import { Injectable, Logger } from '@nestjs/common';
import { desc, sql } from 'drizzle-orm';
import {
  ledgerReconciliationRuns,
  wallets,
  type LedgerReconciliationRun,
} from '@casino/db';
import { AuditLogService } from '../audit/audit-log.service';
import type { TenantDb } from '../tenant-resolver/tenant-context';

/**
 * Tipos que SUMAN al balance. Igual que WalletService.CREDIT_TYPES + `adjustment`:
 * este último es el lado target (crédito) de las cargas por corrección de
 * empleado — `executeTransferPair` lo acredita aunque `directionFor` lo etiquete
 * neutral. Sin incluirlo, cada corrección genera un descuadre falso.
 */
const CREDIT_TYPES_SQL =
  "'mint','load','transfer_in','win','deposit','bonus_grant','bonus_clear'," +
  "'bonus_funding_revert','jackpot_win','promo_reward','league_reward'," +
  "'commission_payout','fund_release','adjustment'";

/** Tipos que RESTAN del balance (igual que WalletService.DEBIT_TYPES). */
const DEBIT_TYPES_SQL =
  "'burn','unload','transfer_out','bet','withdrawal','bonus_forfeit'," +
  "'bonus_funding','fund_reserve'";

/** Cuántos descuadres se guardan en detalle (el resto se cuenta). */
const MAX_MISMATCH_DETAIL = 100;

export interface WalletMismatch {
  walletId: string;
  userId: string | null;
  username: string | null;
  kind: 'balance' | 'locked';
  stored: string;
  ledger: string;
  diff: string;
}

export interface SupplySnapshot {
  totalMinted: string;
  totalBurned: string;
  totalDeposited: string;
  totalWithdrawn: string;
  totalWon: string;
  totalBet: string;
  totalCommission: string;
  circulating: string;
  locked: string;
  /** Σ(créditos)−Σ(débitos) sobre TODAS las tx. Debe == circulating. */
  netLedger: string;
  /** circulating − netLedger. ≠ 0 ⇒ drift global (no debería pasar si cada wallet cuadra). */
  conservationDiff: string;
}

export interface ReconciliationRunOptions {
  trigger: 'cron' | 'manual';
  triggeredByUserId?: string | null;
}

function rowsOf<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  const r = (res as { rows?: T[] }).rows;
  return Array.isArray(r) ? r : [];
}

@Injectable()
export class LedgerReconciliationService {
  private readonly logger = new Logger(LedgerReconciliationService.name);

  constructor(private readonly audit: AuditLogService) {}

  /**
   * Corre el chequeo completo, persiste la corrida y (si hay descuadre)
   * escribe el aviso en audit_log. Devuelve la fila persistida.
   */
  async runReconciliation(
    db: TenantDb,
    opts: ReconciliationRunOptions,
  ): Promise<LedgerReconciliationRun> {
    const startedAt = Date.now();

    let walletsChecked = 0;
    let balanceMismatches: WalletMismatch[] = [];
    let holdMismatches: WalletMismatch[] = [];
    let supply: SupplySnapshot | null = null;
    let status: 'ok' | 'mismatch' | 'error' = 'ok';
    let errorMsg: string | null = null;

    try {
      walletsChecked = await this.countWallets(db);
      balanceMismatches = await this.checkBalances(db);
      holdMismatches = await this.checkHolds(db);
      supply = await this.computeSupply(db);
      status =
        balanceMismatches.length > 0 || holdMismatches.length > 0
          ? 'mismatch'
          : 'ok';
    } catch (err) {
      status = 'error';
      errorMsg = (err as Error).message;
      this.logger.error(`Reconciliación falló: ${errorMsg}`);
    }

    const allMismatches = [...balanceMismatches, ...holdMismatches];
    const durationMs = Date.now() - startedAt;

    const inserted = await db
      .insert(ledgerReconciliationRuns)
      .values({
        trigger: opts.trigger,
        triggeredByUserId: opts.triggeredByUserId ?? null,
        status,
        walletsChecked,
        walletsMismatched: balanceMismatches.length,
        holdsMismatched: holdMismatches.length,
        mismatches:
          allMismatches.length > 0
            ? {
                items: allMismatches.slice(0, MAX_MISMATCH_DETAIL),
                truncated: Math.max(0, allMismatches.length - MAX_MISMATCH_DETAIL),
              }
            : null,
        supply: supply as unknown as Record<string, unknown> | null,
        durationMs,
        error: errorMsg,
      })
      .returning();

    const run = inserted[0]!;

    // Aviso (solo alerta, no bloquea): audit severity high cuando descuadra
    // o cuando el chequeo no fue concluyente.
    if (status !== 'ok') {
      await this.audit.record(db, {
        actorUserId: opts.triggeredByUserId ?? null,
        actionCode:
          status === 'mismatch'
            ? 'ledger.reconciliation_mismatch'
            : 'ledger.reconciliation_error',
        targetType: 'ledger_reconciliation_run',
        targetId: run.id,
        reason:
          status === 'mismatch'
            ? `Las fichas no cuadran: ${balanceMismatches.length} wallet(s) con balance descuadrado, ${holdMismatches.length} con locked descuadrado.`
            : `El chequeo de integridad del ledger no pudo completarse: ${errorMsg}`,
        metadata: {
          severity: 'high',
          trigger: opts.trigger,
          walletsChecked,
          walletsMismatched: balanceMismatches.length,
          holdsMismatched: holdMismatches.length,
          sample: allMismatches.slice(0, 5),
        },
      });
      this.logger.warn(
        `Reconciliación ${status}: ${balanceMismatches.length} balance + ${holdMismatches.length} locked descuadres (de ${walletsChecked} wallets).`,
      );
    }

    return run;
  }

  /** Lista las últimas corridas para el panel (más nuevas primero). */
  async listRuns(
    db: TenantDb,
    params: { limit?: number; offset?: number } = {},
  ): Promise<{ runs: LedgerReconciliationRun[]; total: number }> {
    const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
    const offset = Math.max(params.offset ?? 0, 0);

    const runs = await db
      .select()
      .from(ledgerReconciliationRuns)
      .orderBy(desc(ledgerReconciliationRuns.runAt), desc(ledgerReconciliationRuns.id))
      .limit(limit)
      .offset(offset);

    const totalRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(ledgerReconciliationRuns);
    const total = totalRows[0]?.count ?? 0;

    return { runs, total };
  }

  /** Última corrida (la que el panel muestra arriba). Null si nunca corrió. */
  async getLatestRun(db: TenantDb): Promise<LedgerReconciliationRun | null> {
    const rows = await db
      .select()
      .from(ledgerReconciliationRuns)
      .orderBy(desc(ledgerReconciliationRuns.runAt), desc(ledgerReconciliationRuns.id))
      .limit(1);
    return rows[0] ?? null;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Chequeos (read-only sobre la economía)
  // ──────────────────────────────────────────────────────────────────────

  private async countWallets(db: TenantDb): Promise<number> {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(wallets);
    return rows[0]?.count ?? 0;
  }

  /**
   * Wallets cuyo `balance` no coincide con Σ(créditos)−Σ(débitos) del ledger.
   * Devuelve solo los descuadres (lista vacía = todo cuadra).
   */
  private async checkBalances(db: TenantDb): Promise<WalletMismatch[]> {
    const res = await db.execute(sql`
      SELECT t.wallet_id, t.user_id, t.username,
             t.stored::text AS stored,
             t.ledger::text AS ledger,
             (t.stored - t.ledger)::text AS diff
      FROM (
        SELECT w.id AS wallet_id, w.user_id, u.username,
               w.balance AS stored,
               COALESCE(SUM(
                 CASE
                   WHEN wt.type IN (${sql.raw(CREDIT_TYPES_SQL)}) THEN wt.amount
                   WHEN wt.type IN (${sql.raw(DEBIT_TYPES_SQL)}) THEN -wt.amount
                   ELSE 0
                 END
               ), 0) AS ledger
        FROM wallets w
        LEFT JOIN wallet_transactions wt ON wt.wallet_id = w.id
        LEFT JOIN users u ON u.id = w.user_id
        GROUP BY w.id, w.user_id, u.username, w.balance
      ) t
      WHERE t.stored <> t.ledger
      ORDER BY ABS(t.stored - t.ledger) DESC
    `);

    return rowsOf<{
      wallet_id: string;
      user_id: string | null;
      username: string | null;
      stored: string;
      ledger: string;
      diff: string;
    }>(res).map((r) => ({
      walletId: r.wallet_id,
      userId: r.user_id,
      username: r.username,
      kind: 'balance' as const,
      stored: r.stored,
      ledger: r.ledger,
      diff: r.diff,
    }));
  }

  /**
   * Wallets cuyo `locked_balance` no coincide con Σ(holds activos).
   */
  private async checkHolds(db: TenantDb): Promise<WalletMismatch[]> {
    const res = await db.execute(sql`
      SELECT t.wallet_id, t.user_id, t.username,
             t.stored::text AS stored,
             t.ledger::text AS ledger,
             (t.stored - t.ledger)::text AS diff
      FROM (
        SELECT w.id AS wallet_id, w.user_id, u.username,
               w.locked_balance AS stored,
               COALESCE(SUM(h.amount) FILTER (WHERE h.released_at IS NULL), 0) AS ledger
        FROM wallets w
        LEFT JOIN wallet_holds h ON h.wallet_id = w.id
        LEFT JOIN users u ON u.id = w.user_id
        GROUP BY w.id, w.user_id, u.username, w.locked_balance
      ) t
      WHERE t.stored <> t.ledger
      ORDER BY ABS(t.stored - t.ledger) DESC
    `);

    return rowsOf<{
      wallet_id: string;
      user_id: string | null;
      username: string | null;
      stored: string;
      ledger: string;
      diff: string;
    }>(res).map((r) => ({
      walletId: r.wallet_id,
      userId: r.user_id,
      username: r.username,
      kind: 'locked' as const,
      stored: r.stored,
      ledger: r.ledger,
      diff: r.diff,
    }));
  }

  /** Snapshot agregado del supply de fichas (en strings numeric(20,2)). */
  async computeSupply(db: TenantDb): Promise<SupplySnapshot> {
    const txRes = await db.execute(sql`
      SELECT
        COALESCE(SUM(amount) FILTER (WHERE type = 'mint'), 0)::text AS minted,
        COALESCE(SUM(amount) FILTER (WHERE type = 'burn'), 0)::text AS burned,
        COALESCE(SUM(amount) FILTER (WHERE type = 'deposit'), 0)::text AS deposited,
        COALESCE(SUM(amount) FILTER (WHERE type = 'withdrawal'), 0)::text AS withdrawn,
        COALESCE(SUM(amount) FILTER (WHERE type = 'win'), 0)::text AS won,
        COALESCE(SUM(amount) FILTER (WHERE type = 'bet'), 0)::text AS bet,
        COALESCE(SUM(amount) FILTER (WHERE type = 'commission_payout'), 0)::text AS commission,
        COALESCE(SUM(
          CASE
            WHEN type IN (${sql.raw(CREDIT_TYPES_SQL)}) THEN amount
            WHEN type IN (${sql.raw(DEBIT_TYPES_SQL)}) THEN -amount
            ELSE 0
          END
        ), 0)::text AS net_ledger
      FROM wallet_transactions
    `);
    const tx = rowsOf<{
      minted: string;
      burned: string;
      deposited: string;
      withdrawn: string;
      won: string;
      bet: string;
      commission: string;
      net_ledger: string;
    }>(txRes)[0]!;

    const wRes = await db.execute(sql`
      SELECT COALESCE(SUM(balance), 0)::text AS circulating,
             COALESCE(SUM(locked_balance), 0)::text AS locked
      FROM wallets
    `);
    const w = rowsOf<{ circulating: string; locked: string }>(wRes)[0]!;

    const conservationDiff = (
      Math.round((Number(w.circulating) - Number(tx.net_ledger)) * 100) / 100
    ).toFixed(2);

    return {
      totalMinted: tx.minted,
      totalBurned: tx.burned,
      totalDeposited: tx.deposited,
      totalWithdrawn: tx.withdrawn,
      totalWon: tx.won,
      totalBet: tx.bet,
      totalCommission: tx.commission,
      circulating: w.circulating,
      locked: w.locked,
      netLedger: tx.net_ledger,
      conservationDiff,
    };
  }
}
