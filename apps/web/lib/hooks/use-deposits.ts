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
import { invalidateAllBalances } from '../query-balances';

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
  /**
   * Origen comercial del jugador (derivado de la jerarquía en backend):
   *   - 'casa': red central del admin (directo o vía cajero/distribuidor).
   *   - 'socio': cuelga de un socio dependiente (`originSocioName`).
   */
  originKind?: 'casa' | 'socio';
  originSocioId?: string | null;
  originSocioName?: string | null;
  originSocioUsername?: string | null;
}

interface DepositsListResponse {
  data: DepositRow[];
  total: number;
}

export interface DepositsFilters {
  status?: DepositStatus[];
  userId?: string;
  assignedTo?: string;
  /** Filtros de la barra (aplican a la lista Y al export). */
  fromDate?: string; // ISO
  toDate?: string; // ISO
  methodId?: string;
  matched?: boolean;
  userSearch?: string;
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
  if (filters.fromDate) params.set('fromDate', filters.fromDate);
  if (filters.toDate) params.set('toDate', filters.toDate);
  if (filters.methodId) params.set('methodId', filters.methodId);
  if (filters.matched !== undefined) {
    params.set('matched', filters.matched ? 'yes' : 'no');
  }
  if (filters.userSearch) params.set('userSearch', filters.userSearch);
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));
  const q = params.toString();
  return q ? `?${q}` : '';
}

/**
 * Sprint 51.7: `refetchInterval` opcional para auto-refresh del review
 * queue. Pasar `refetchInterval: 15_000` desde el page cuando el tab
 * 'queue' está activo. En otros tabs, no se pasa → no hay polling.
 */
export function useDeposits(
  filters: DepositsFilters,
  options?: { refetchInterval?: number | false; enabled?: boolean },
) {
  const query = buildQuery(filters);
  return useQuery({
    queryKey: ['deposits', filters],
    queryFn: () => apiGet<DepositsListResponse>(`/tenant/deposits${query}`),
    staleTime: 15_000,
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval,
    // Sprint 51.7: refetchea aun cuando el tab está en background — el
    // operador puede tener la pantalla en otro monitor.
    refetchIntervalInBackground: !!options?.refetchInterval,
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
    mutationFn: (bonusDefinitionId?: string) => {
      if (!id) throw new Error('depositId requerido');
      return apiPost<ApproveResponse>(
        `/tenant/deposits/${id}/approve`,
        bonusDefinitionId ? { bonusDefinitionId } : {},
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deposits'] });
      if (id) qc.invalidateQueries({ queryKey: ['deposit-detail', id] });
      // Aprobar acredita la wallet del user (+ bonus): refresca todos los
      // balances para verlo en el momento.
      invalidateAllBalances(qc);
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

export function useReviewDeposit(id: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => {
      if (!id) throw new Error('depositId requerido');
      return apiPost<{ deposit: DepositRow }>(`/tenant/deposits/${id}/review`);
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
    // Fase B: el jugador debe ver la acreditación sin recargar la página.
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
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
  /** Sprint 55: SHA-256 del contenido (lo devuelve /upload-proof). */
  receiptHash?: string;
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
  /** Sprint 55: SHA-256 del contenido — token de dedupe real por archivo. */
  receiptHash: string;
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
