/**
 * Hooks de retiros (review de operador).
 *
 * Endpoints:
 *   - GET    /tenant/withdrawals
 *   - GET    /tenant/withdrawals/:id
 *   - POST   /tenant/withdrawals/:id/approve     → pending → approved (sin mover saldo todavía)
 *   - POST   /tenant/withdrawals/:id/reject      → con reason, libera hold
 *   - POST   /tenant/withdrawals/:id/mark-paid   → approved → paid (debita wallet del user)
 *   - POST   /tenant/withdrawals/:id/mark-failed → con reason, libera hold
 *
 * Ciclo de vida:
 *   pending → (approve) → approved → (mark-paid) → paid
 *   pending → (reject)  → rejected (libera hold)
 *   approved → (mark-failed) → failed (libera hold)
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../api-client';

export type WithdrawalStatus =
  | 'pending'
  | 'approved'
  | 'processing'
  | 'paid'
  | 'rejected'
  | 'failed';

export interface WithdrawalRow {
  id: string;
  userId: string;
  userUsername: string | null;
  userDisplayName: string | null;
  methodId: string;
  methodCode: string | null;
  methodName: string | null;
  amountChips: string;
  amountFiat: string;
  currencyFiat: string;
  status: WithdrawalStatus;
  reason: string | null;
  externalRef: string | null;
  targetAccount: Record<string, unknown>;
  walletTxId: string | null;
  holdId: string | null;
  /** Sprint 51: outgoing bank_tx asociada. Requerida para markPaid. */
  bankTransactionId?: string | null;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  approvedByUserId: string | null;
  paidAt: string | null;
}

interface WithdrawalsListResponse {
  data: WithdrawalRow[];
  total: number;
}

export interface WithdrawalsFilters {
  status?: WithdrawalStatus[];
  userId?: string;
  assignedTo?: string;
  limit?: number;
  offset?: number;
}

function buildQuery(filters: WithdrawalsFilters): string {
  const params = new URLSearchParams();
  if (filters.status && filters.status.length > 0) {
    params.set('status', filters.status.join(','));
  }
  if (filters.userId) params.set('userId', filters.userId);
  if (filters.assignedTo) params.set('assignedTo', filters.assignedTo);
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));
  const q = params.toString();
  return q ? `?${q}` : '';
}

export function useWithdrawals(filters: WithdrawalsFilters) {
  const query = buildQuery(filters);
  return useQuery({
    queryKey: ['withdrawals', filters],
    queryFn: () => apiGet<WithdrawalsListResponse>(`/tenant/withdrawals${query}`),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });
}

export interface WithdrawalDetailResponse {
  withdrawal: WithdrawalRow;
  walletTx: {
    id: string;
    type: string;
    amount: string;
    balanceAfter: string;
    createdAt: string;
  } | null;
}

export function useWithdrawalDetail(id: string | null) {
  return useQuery({
    queryKey: ['withdrawal-detail', id],
    queryFn: () => apiGet<WithdrawalDetailResponse>(`/tenant/withdrawals/${id}`),
    enabled: !!id,
    staleTime: 15_000,
  });
}

// ──────────────────────────────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────────────────────────────

interface ActionResponse {
  withdrawal: WithdrawalRow;
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>, id: string | null) {
  qc.invalidateQueries({ queryKey: ['withdrawals'] });
  if (id) qc.invalidateQueries({ queryKey: ['withdrawal-detail', id] });
  qc.invalidateQueries({ queryKey: ['my-wallet'] });
  qc.invalidateQueries({ queryKey: ['my-transactions'] });
}

export function useApproveWithdrawal(id: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => {
      if (!id) throw new Error('withdrawalId requerido');
      return apiPost<ActionResponse>(`/tenant/withdrawals/${id}/approve`);
    },
    onSuccess: () => invalidateAll(qc, id),
  });
}

export function useRejectWithdrawal(id: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { reason: string }) => {
      if (!id) throw new Error('withdrawalId requerido');
      return apiPost<ActionResponse>(`/tenant/withdrawals/${id}/reject`, payload);
    },
    onSuccess: () => invalidateAll(qc, id),
  });
}

export function useMarkPaidWithdrawal(id: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { externalRef: string; notes?: string }) => {
      if (!id) throw new Error('withdrawalId requerido');
      return apiPost<ActionResponse>(`/tenant/withdrawals/${id}/mark-paid`, payload);
    },
    onSuccess: () => invalidateAll(qc, id),
  });
}

export function useMarkFailedWithdrawal(id: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { reason: string }) => {
      if (!id) throw new Error('withdrawalId requerido');
      return apiPost<ActionResponse>(`/tenant/withdrawals/${id}/mark-failed`, payload);
    },
    onSuccess: () => invalidateAll(qc, id),
  });
}

// ──────────────────────────────────────────────────────────────────────
// Player-facing: mis retiros + crear nuevo
// ──────────────────────────────────────────────────────────────────────

interface MyWithdrawalsResponse {
  data: WithdrawalRow[];
}

export function useMyWithdrawals(limit = 50, offset = 0) {
  return useQuery({
    queryKey: ['my-withdrawals', { limit, offset }],
    queryFn: () =>
      apiGet<MyWithdrawalsResponse>(
        `/tenant/withdrawals/mine?limit=${limit}&offset=${offset}`,
      ),
    staleTime: 15_000,
  });
}

export interface CreateWithdrawalPayload {
  methodId: string;
  amountChips: string;
  amountFiat: string;
  currencyFiat: 'ARS' | 'USDT' | 'USD' | 'BRL';
  /** Datos del destino (CBU, address USDT, etc.). Shape libre. */
  targetAccount: Record<string, unknown>;
}

interface CreateWithdrawalResponse {
  withdrawal: WithdrawalRow;
}

export function useCreateWithdrawal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateWithdrawalPayload) =>
      apiPost<CreateWithdrawalResponse>('/tenant/withdrawals', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-withdrawals'] });
      // El backend ya hace el hold inmediato → balance cambia.
      qc.invalidateQueries({ queryKey: ['my-wallet'] });
      qc.invalidateQueries({ queryKey: ['my-transactions'] });
    },
  });
}
