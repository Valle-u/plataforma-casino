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
import { apiGet, apiPost, apiUpload } from '../api-client';

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
  /** Sprint 51.6: URL del comprobante (regenerada si signed). Anterior alias: proofUrl. */
  receiptUrl: string | null;
  /** Sprint 51.6: storage key opaco — para drivers con signed URLs. */
  receiptStorageKey: string | null;
  externalRef: string | null;
  walletTxId: string | null;
  /** Sprint 50: bank_transaction asociada (NULL hasta matchear). Requerida para approve. */
  bankTransactionId?: string | null;
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

// ──────────────────────────────────────────────────────────────────────
// Player-facing: mis depósitos + crear nuevo
// ──────────────────────────────────────────────────────────────────────

interface MyDepositsResponse {
  data: DepositRow[];
}

export function useMyDeposits(limit = 50, offset = 0) {
  return useQuery({
    queryKey: ['my-deposits', { limit, offset }],
    queryFn: () =>
      apiGet<MyDepositsResponse>(
        `/tenant/deposits/mine?limit=${limit}&offset=${offset}`,
      ),
    staleTime: 15_000,
  });
}

export interface CreateDepositPayload {
  methodId: string;
  amountFiat: string;
  currencyFiat: 'ARS' | 'USDT' | 'USD' | 'BRL';
  amountChips: string;
  /** Sprint 51.6: ahora obligatorio. */
  receiptUrl: string;
  receiptStorageKey: string;
  externalRef?: string;
}

interface CreateDepositResponse {
  deposit: {
    id: string;
    status: DepositStatus;
    amountChips: string;
    amountFiat: string;
    currencyFiat: string;
    createdAt: string;
  };
}

export function useCreateDeposit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateDepositPayload) =>
      apiPost<CreateDepositResponse>('/tenant/deposits', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-deposits'] });
      // El balance NO cambia hasta que el cajero apruebe — pero invalidar
      // por las dudas no cuesta nada y mantiene UI sincronizada.
      qc.invalidateQueries({ queryKey: ['my-wallet'] });
    },
  });
}

// ──────────────────────────────────────────────────────────────────────
// Sprint 51.6: upload de comprobante (two-step deposit flow)
// ──────────────────────────────────────────────────────────────────────

export interface UploadProofResponse {
  receiptUrl: string;
  receiptStorageKey: string;
  sizeBytes: number;
}

/**
 * Sube el comprobante via multipart/form-data. El cliente lo llama
 * antes de submit del deposit — recibe `{ receiptUrl, receiptStorageKey }`
 * que después manda en el create-deposit payload.
 */
export function useUploadDepositProof() {
  return useMutation({
    mutationFn: async (file: File): Promise<UploadProofResponse> => {
      const fd = new FormData();
      fd.append('file', file);
      return apiUpload<UploadProofResponse>(
        '/tenant/deposits/upload-proof',
        fd,
      );
    },
  });
}
