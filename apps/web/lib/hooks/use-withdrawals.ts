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
import { invalidateAllBalances } from '../query-balances';

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
  /**
   * Sprint 52: referencia de pago AUTO-GENERADA por el backend al marcar
   * paid (formato WTH-...). El operador ya no escribe referencias manuales.
   */
  paidExternalRef: string | null;
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

export function useWithdrawals(
  filters: WithdrawalsFilters,
  options?: { refetchInterval?: number | false },
) {
  const query = buildQuery(filters);
  return useQuery({
    queryKey: ['withdrawals', filters],
    queryFn: () => apiGet<WithdrawalsListResponse>(`/tenant/withdrawals${query}`),
    staleTime: 15_000,
    refetchInterval: options?.refetchInterval,
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
  // Las acciones de retiro liberan/debitan holds: refresca todos los balances.
  invalidateAllBalances(qc);
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

/**
 * Sprint 52 (decisión dueño): mark-paid es ONE-CLICK, sin payload. El
 * backend auto-genera la paidExternalRef. La outgoing bank_tx (con su
 * comprobante) ya debe estar cargada y matcheada.
 */
export function useMarkPaidWithdrawal(id: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => {
      if (!id) throw new Error('withdrawalId requerido');
      return apiPost<ActionResponse>(`/tenant/withdrawals/${id}/mark-paid`);
    },
    onSuccess: () => invalidateAll(qc, id),
  });
}

// ──────────────────────────────────────────────────────────────────────
// Fase 2: pago completo (endpoint compuesto).
// En UNA operación: carga la bank_tx saliente + la matchea + marca paid.
// Requiere header Idempotency-Key y permisos withdrawals.process +
// bank_tx.upload + bank_tx.match.
// ──────────────────────────────────────────────────────────────────────

export interface PayInFullPayload {
  /**
   * Sprint 53 (decisión dueño): opcional. El CBU de origen ya no se
   * carga — con subir el comprobante alcanza.
   */
  bankAccount?: string;
  /** Monto REAL transferido (fiat). Si difiere del amount_fiat del retiro
   *  (comisiones), el backend exige `override` + `overrideReason`. */
  amount: string;
  currency?: string;
  /** Fecha/hora en que se ejecutó la transferencia (ISO). */
  receivedAt: string;
  /** Destinatario del pago (metadata, opcional). */
  senderName?: string;
  /**
   * Sprint 52: comprobante de pago (flujo two-step — primero
   * `POST /tenant/bank-transactions/upload-proof`). OBLIGATORIO. El mismo
   * `receiptStorageKey` no puede reutilizarse (dedupe por comprobante).
   */
  receiptUrl: string;
  receiptStorageKey: string;
  /** Sprint 55: SHA-256 del contenido (lo devuelve /upload-proof). */
  receiptHash?: string;
  notes?: string;
  override?: boolean;
  overrideReason?: string;
}

export interface PayInFullResponse {
  withdrawal: WithdrawalRow;
  bankTransaction: {
    id: string;
    direction: string;
    status: string;
    amount: string;
    matchedWithdrawalId: string | null;
    overrideReason: string | null;
  } | null;
  walletTx: {
    id: string;
    type: string;
    amount: string;
  } | null;
}

/** Key de idempotencia por apertura del modal — retries seguros. */
export function newPayInFullIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Array.from({ length: 32 })
    .map(() => Math.floor(Math.random() * 16).toString(16))
    .join('');
}

export function usePayInFullWithdrawal(id: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { payload: PayInFullPayload; idempotencyKey: string }) => {
      if (!id) throw new Error('withdrawalId requerido');
      return apiPost<PayInFullResponse>(
        `/tenant/withdrawals/${id}/pay-in-full`,
        args.payload,
        { idempotencyKey: args.idempotencyKey },
      );
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
    // Fase B: el jugador debe ver el estado del retiro sin recargar.
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
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
      invalidateAllBalances(qc);
    },
  });
}
