/**
 * Tabla `ledger_reconciliation_runs` (DB de tenant).
 *
 * Registro APPEND-ONLY de cada corrida del validador de invariante del ledger
 * (el "chequeo de que las fichas cuadran"). Ver `docs/14-roadmap.md §10.6 ·
 * Blindaje del núcleo económico → Parte A`.
 *
 * Cada fila es una foto de un chequeo: cuántas wallets se revisaron, cuántas
 * descuadraron (y el detalle), y un snapshot del supply de fichas al momento.
 *
 * El validador chequea, sobre el ledger inmutable `wallet_transactions`:
 *   1. `wallets.balance == Σ(créditos) − Σ(débitos)` por wallet (integridad).
 *   2. `wallets.locked_balance == Σ(holds activos)` por wallet.
 *   3. Snapshot de supply (minteado / quemado / depositado / retirado / en
 *      circulación) — base para la futura reconciliación con respaldo real.
 *
 * Política (decidida 2026-06-29): ante un descuadre **solo alerta** (deja la
 * fila con `status='mismatch'` + entrada en `audit_log` severity high), NO
 * bloquea operaciones. Corre nocturno (cron) + on-demand (botón admin).
 *
 * NUNCA UPDATE ni DELETE — es un registro histórico para auditar.
 */

import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { generateUuidV7 } from '../utils/uuid';
import { users } from './users';

export const ledgerReconciliationRuns = pgTable(
  'ledger_reconciliation_runs',
  {
    id: uuid('id').primaryKey().$defaultFn(generateUuidV7),

    /** Momento en que corrió el chequeo. */
    runAt: timestamp('run_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),

    /** Quién lo disparó: 'cron' (nocturno automático) | 'manual' (botón admin). */
    trigger: text('trigger').notNull(),

    /** User que disparó el run manual. NULL para corridas del cron. */
    triggeredByUserId: uuid('triggered_by_user_id').references(() => users.id),

    /**
     * Resultado global:
     *   - 'ok': todas las wallets cuadran.
     *   - 'mismatch': al menos una wallet descuadra (balance o locked).
     *   - 'error': el chequeo falló por una excepción (no concluyente).
     */
    status: text('status').notNull(),

    /** Cantidad de wallets revisadas. */
    walletsChecked: integer('wallets_checked').notNull().default(0),

    /** Cantidad de wallets con `balance` descuadrado vs el ledger. */
    walletsMismatched: integer('wallets_mismatched').notNull().default(0),

    /** Cantidad de wallets con `locked_balance` descuadrado vs los holds activos. */
    holdsMismatched: integer('holds_mismatched').notNull().default(0),

    /**
     * Detalle de los descuadres (array JSON). Cada item:
     *   { walletId, userId, username, kind: 'balance'|'locked',
     *     stored, ledger, diff }
     * Acotado a los primeros N para no inflar la fila (el resto se cuenta).
     */
    mismatches: jsonb('mismatches'),

    /**
     * Snapshot del supply de fichas al momento del chequeo (objeto JSON):
     *   { totalMinted, totalBurned, totalDeposited, totalWithdrawn,
     *     totalWon, totalBet, totalCommission, circulating, locked,
     *     netConservation } — todos strings numeric(20,2).
     */
    supply: jsonb('supply'),

    /** Duración del chequeo en milisegundos. */
    durationMs: integer('duration_ms'),

    /** Mensaje de error si `status='error'`. */
    error: text('error'),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'ledger_recon_trigger_valid',
      sql`${table.trigger} IN ('cron', 'manual')`,
    ),
    check(
      'ledger_recon_status_valid',
      sql`${table.status} IN ('ok', 'mismatch', 'error')`,
    ),
    // Para el panel: "últimas corridas ordenadas por fecha".
    index('ledger_recon_run_at').on(table.runAt),
  ],
);

export type LedgerReconciliationRun = typeof ledgerReconciliationRuns.$inferSelect;
export type NewLedgerReconciliationRun =
  typeof ledgerReconciliationRuns.$inferInsert;
