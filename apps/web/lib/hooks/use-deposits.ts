/**
 * Hooks de depósitos (review de operador).
 *
 * `useDeposits(filters)` — `GET /tenant/deposits` con filtros
 *   server-side: status[], userId, assignedTo, limit, offset.
 * `useDepositDetail(id)` — `GET /tenant/deposits/:id` (incluye walletTx).
 * `useApproveDeposit(id)` — `POST /tenant/deposits/:id/approve`.
 * `useRejectDeposit(id)` — `POST /tenant/deposits/:id/reject { reason }`.
 *
 * Mutations invalidan list + detail post-success para refresco automático.
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../api-client';

export type DepositStatus =
  | 'pending'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'cancelled';

export interface DepositRow {
  id: string;
  userId: string;
  /** Enriquecido por backend via JOIN — siempre presente desde sprint 6. */
  userUsername: string | null;
  userDisplayName: string | null;
  methodId: string;
  methodCode: string | null;
  methodName: string | null;
  amountChips: string;
  amountFiat: string;
  currencyFiat: string;
  status: DepositStatus;
  reason: string | null;
  proofUrl: string | null;
  externalRef: string | null;
  walletTxId: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  approvedAt: string | null;
  approvedByUserId: string | null;
}

interface DepositsListResponse {
  data: DepositRow[];
  total: number;
}

export interface DepositsFilters {
  status?: DepositStatus[];
  userId?: string;
  assignedTo?: string;
  limit?: number;
  offset?: number;
}

function buildQuery(filters: DepositsFilters): string {
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

export function useDeposits(filters: DepositsFilters) {
  const query = buildQuery(filters);
  return useQuery({
    queryKey: ['deposits', filters],
    queryFn: () => apiGet<DepositsListResponse>(`/tenant/deposits${query}`),
    staleTime: 15_000,
  });
}

export interface DepositDetailResponse {
  deposit: DepositRow;
  walletTx: {
    id: string;
    type: string;
    amount: string;
    balanceAfter: string;
    createdAt: string;
  } | null;
}

export function useDepositDetail(id: string | null) {
  return useQuery({
    queryKey: ['deposit-detail', id],
    queryFn: () => apiGet<DepositDetailResponse>(`/tenant/deposits/${id}`),
    enabled: !!id,
    staleTime: 15_000,
  });
}

// ──────────────────────────────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────────────────────────────

interface ApproveResponse {
  deposit: DepositRow;
  walletTxId: string | null;
}

export function useApproveDeposit(id: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => {
      if (!id) throw new Error('depositId requerido');
      return apiPost<ApproveResponse>(`/tenant/deposits/${id}/approve`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deposits'] });
      if (id) qc.invalidateQueries({ queryKey: ['deposit-detail', id] });
      qc.invalidateQueries({ queryKey: ['my-wallet'] });
      qc.invalidateQueries({ queryKey: ['my-transactions'] });
    },
  });
}

interface RejectResponse {
  deposit: DepositRow;
}

export function useRejectDeposit(id: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { reason: string }) => {
      if (!id) throw new Error('depositId requerido');
      return apiPost<RejectResponse>(`/tenant/deposits/${id}/reject`, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deposits'] });
      if (id) qc.invalidateQueries({ queryKey: ['deposit-detail', id] });
    },
  });
}
