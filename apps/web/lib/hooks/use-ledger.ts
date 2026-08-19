/**
 * Hooks del panel de integridad del ledger (Blindaje núcleo económico, Parte A).
 *
 * Endpoints (todos requieren ledger.view; reconcile requiere ledger.reconcile):
 *   - GET  /tenant/ledger/reconciliations/latest   → { run }
 *   - GET  /tenant/ledger/reconciliations?limit&offset → { runs, total }
 *   - GET  /tenant/ledger/supply                    → SupplySnapshot (en vivo)
 *   - POST /tenant/ledger/reconcile                 → ReconciliationRun
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../api-client';

export type ReconciliationStatus = 'ok' | 'mismatch' | 'error';
export type ReconciliationTrigger = 'cron' | 'manual';

export interface WalletMismatch {
  walletId: string;
  userId: string | null;
  username: string | null;
  kind: 'balance' | 'locked' | 'bonus';
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
  netLedger: string;
  conservationDiff: string;
}

export interface ReconciliationRun {
  id: string;
  runAt: string;
  trigger: ReconciliationTrigger;
  triggeredByUserId: string | null;
  status: ReconciliationStatus;
  walletsChecked: number;
  walletsMismatched: number;
  holdsMismatched: number;
  mismatches: { items: WalletMismatch[]; truncated: number } | null;
  supply: SupplySnapshot | null;
  durationMs: number | null;
  error: string | null;
  createdAt: string;
}

export function useLatestReconciliation() {
  return useQuery({
    queryKey: ['ledger-latest'],
    queryFn: () =>
      apiGet<{ run: ReconciliationRun | null }>(
        '/tenant/ledger/reconciliations/latest',
      ),
    staleTime: 15_000,
  });
}

export function useReconciliations(limit = 20, offset = 0) {
  return useQuery({
    queryKey: ['ledger-runs', limit, offset],
    queryFn: () =>
      apiGet<{ runs: ReconciliationRun[]; total: number }>(
        `/tenant/ledger/reconciliations?limit=${limit}&offset=${offset}`,
      ),
    staleTime: 15_000,
  });
}

export function useLedgerSupply() {
  return useQuery({
    queryKey: ['ledger-supply'],
    queryFn: () => apiGet<SupplySnapshot>('/tenant/ledger/supply'),
    staleTime: 15_000,
  });
}

/** Corre el chequeo on-demand (botón "Correr ahora"). */
export function useRunReconciliation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<ReconciliationRun>('/tenant/ledger/reconcile', {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ledger-latest'] });
      qc.invalidateQueries({ queryKey: ['ledger-runs'] });
      qc.invalidateQueries({ queryKey: ['ledger-supply'] });
      qc.invalidateQueries({ queryKey: ['audit-log'] });
    },
  });
}
