/**
 * Hooks de bank-transactions (Sprint 50).
 *
 * Empleado sube transferencias entrantes; cajero matchea con deposits.
 *
 * Endpoints:
 *   POST   /tenant/bank-transactions                          (bank_tx.upload)
 *   GET    /tenant/bank-transactions?status=&...              (bank_tx.view)
 *   GET    /tenant/bank-transactions/unmatched-for-amount/:x  (bank_tx.match)
 *   POST   /tenant/bank-transactions/:id/match/:depositId     (bank_tx.match)
 *   POST   /tenant/bank-transactions/:id/unmatch              (bank_tx.match)
 *   DELETE /tenant/bank-transactions/:id                      (bank_tx.delete)
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../api-client';

export type BankTxStatus = 'unmatched' | 'matched' | 'disputed';
/** Sprint 51: incoming = entrante (deposits), outgoing = saliente (withdrawals). */
export type BankTxDirection = 'incoming' | 'outgoing';

export interface BankTransaction {
  id: string;
  bankAccount: string;
  amount: string;
  currency: string;
  /** Sprint 51 */
  direction: BankTxDirection;
  senderName: string | null;
  senderCbu: string | null;
  reference: string | null;
  bankReference: string | null;
  receivedAt: string;
  status: BankTxStatus;
  uploadedBy: string;
  uploaderUsername: string | null;
  uploadedAt: string;
  matchedDepositId: string | null;
  /** Sprint 51 */
  matchedWithdrawalId: string | null;
  matchedBy: string | null;
  matchedAt: string | null;
  overrideReason: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListResponse {
  data: BankTransaction[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface BankTxFilters {
  status?: BankTxStatus;
  /** Sprint 51 */
  direction?: BankTxDirection;
  bankAccount?: string;
  amount?: string;
  dateFrom?: string;
  dateTo?: string;
  uploadedBy?: string;
  limit?: number;
  offset?: number;
}

function qs(filters: object): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters as Record<string, unknown>)) {
    if (v === undefined || v === null || v === '') continue;
    // Solo serializamos primitivos como query params — un object/array
    // en un filtro implicaría una mala signature, lo skipeamos.
    if (typeof v === 'string') params.set(k, v);
    else if (typeof v === 'number' || typeof v === 'boolean')
      params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

export function useBankTransactions(filters: BankTxFilters = {}) {
  return useQuery({
    queryKey: ['bank-tx-list', filters],
    queryFn: () => apiGet<ListResponse>(`/tenant/bank-transactions${qs(filters)}`),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });
}

export function useUnmatchedForAmount(
  amount: string,
  includeAll = false,
  direction: BankTxDirection = 'incoming',
) {
  return useQuery({
    queryKey: ['bank-tx-unmatched', amount, includeAll, direction],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('direction', direction);
      if (includeAll) params.set('includeAll', 'true');
      return apiGet<{ data: BankTransaction[] }>(
        `/tenant/bank-transactions/unmatched-for-amount/${encodeURIComponent(amount)}?${params.toString()}`,
      );
    },
    enabled: amount.length > 0,
    staleTime: 5_000,
  });
}

export interface UploadBankTxPayload {
  bankAccount: string;
  amount: string;
  currency?: string;
  /** Sprint 51: 'incoming' (default) o 'outgoing'. */
  direction?: BankTxDirection;
  senderName?: string;
  senderCbu?: string;
  reference?: string;
  bankReference?: string;
  receivedAt: string;
  notes?: string;
}

function invalidate(qc: ReturnType<typeof useQueryClient>): void {
  qc.invalidateQueries({ queryKey: ['bank-tx-list'] });
  qc.invalidateQueries({ queryKey: ['bank-tx-unmatched'] });
}

export function useUploadBankTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: UploadBankTxPayload) =>
      apiPost<BankTransaction>('/tenant/bank-transactions', payload),
    onSuccess: () => invalidate(qc),
  });
}

export interface MatchPayload {
  override?: boolean;
  overrideReason?: string;
}

export function useMatchBankTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { bankTxId: string; depositId: string; payload?: MatchPayload }) =>
      apiPost<BankTransaction>(
        `/tenant/bank-transactions/${params.bankTxId}/match/${params.depositId}`,
        params.payload ?? {},
      ),
    onSuccess: () => {
      invalidate(qc);
      qc.invalidateQueries({ queryKey: ['deposits'] });
    },
  });
}

export function useUnmatchBankTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (bankTxId: string) =>
      apiPost<BankTransaction>(`/tenant/bank-transactions/${bankTxId}/unmatch`, {}),
    onSuccess: () => {
      invalidate(qc);
      qc.invalidateQueries({ queryKey: ['deposits'] });
      qc.invalidateQueries({ queryKey: ['withdrawals'] });
    },
  });
}

/**
 * Sprint 51: matchea una outgoing bank_tx con un withdrawal antes de
 * que el cajero pueda marcarlo paid.
 */
export function useMatchBankTransactionWithdrawal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      bankTxId: string;
      withdrawalId: string;
      payload?: MatchPayload;
    }) =>
      apiPost<BankTransaction>(
        `/tenant/bank-transactions/${params.bankTxId}/match-withdrawal/${params.withdrawalId}`,
        params.payload ?? {},
      ),
    onSuccess: () => {
      invalidate(qc);
      qc.invalidateQueries({ queryKey: ['withdrawals'] });
    },
  });
}

// ──────────────────────────────────────────────────────────────────────
// Commissions settle (Sprint 50)
// ──────────────────────────────────────────────────────────────────────

export interface PendingSummaryRow {
  beneficiaryUserId: string;
  beneficiaryUsername: string | null;
  role: string | null;
  pendingAmount: string;
  payoutsCount: number;
}

export function useCommissionsPendingSummary() {
  return useQuery({
    queryKey: ['commissions-pending-summary'],
    queryFn: () =>
      apiGet<{ data: PendingSummaryRow[]; totalPending: string }>(
        '/tenant/commissions/payouts/pending-summary',
      ),
    staleTime: 30_000,
  });
}

export interface SettleResult {
  settled: number;
  failed: number;
  totalPaid: string;
  results: Array<{ id: string; status: 'paid' | 'failed'; error?: string }>;
}

export function useSettleCommissions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payoutIds?: string[]) =>
      apiPost<SettleResult>('/tenant/commissions/payouts/settle', {
        payoutIds: payoutIds ?? [],
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['commissions-pending-summary'] });
      qc.invalidateQueries({ queryKey: ['commission-payouts'] });
      qc.invalidateQueries({ queryKey: ['commissions-stats'] });
    },
  });
}

export const BANK_TX_STATUS_LABELS: Record<BankTxStatus, string> = {
  unmatched: 'Sin matchear',
  matched: 'Matcheada',
  disputed: 'En disputa',
};

export const BANK_TX_DIRECTION_LABELS: Record<BankTxDirection, string> = {
  incoming: 'Entrante',
  outgoing: 'Saliente',
};
