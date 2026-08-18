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
import { apiDelete, apiGet, apiPatch, apiPost, apiUpload } from '../api-client';
import type {
  DepositDetailResponse,
  DepositRow,
} from './use-deposits';
import type {
  WithdrawalDetailResponse,
  WithdrawalRow,
} from './use-withdrawals';

export type BankTxStatus = 'unmatched' | 'matched' | 'disputed';
/** Sprint 51: incoming = entrante (deposits), outgoing = saliente (withdrawals). */
export type BankTxDirection = 'incoming' | 'outgoing';

export interface BankTransaction {
  id: string;
  /**
   * Sprint 53: nullable — el CBU de origen ya no se exige para salientes
   * (solo el comprobante).
   */
  bankAccount: string | null;
  amount: string;
  currency: string;
  /** Sprint 51 */
  direction: BankTxDirection;
  /**
   * Sprint 54: titular de la cuenta propia del tenant usada en la tx
   * (entrante: la que recibe; saliente: con la que enviamos).
   */
  accountHolder: string | null;
  /** Sprint 54: nombre del banco de la cuenta propia usada. */
  bankName: string | null;
  senderName: string | null;
  senderCbu: string | null;
  reference: string | null;
  /**
   * Sprint 52: comprobante de pago (URL + storage key). OBLIGATORIO para
   * direction='outgoing' (prueba de que la transferencia saliente se
   * ejecutó). El `receiptStorageKey` es el token de dedupe.
   */
  receiptUrl: string | null;
  receiptStorageKey: string | null;
  /**
   * Sprint 55: SHA-256 del CONTENIDO del comprobante — token de dedupe real
   * por archivo (el storage key es un UUID random por upload).
   */
  receiptHash: string | null;
  receivedAt: string;
  status: BankTxStatus;
  uploadedBy: string;
  uploaderUsername: string | null;
  uploadedAt: string;
  matchedDepositId: string | null;
  /** Sprint 51 */
  matchedWithdrawalId: string | null;
  /** Carga (incoming) o retiro (outgoing) manual conciliado con esta transferencia. */
  matchedManualTxId: string | null;
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

/** Con qué está conciliada una transferencia, resuelto a datos legibles. */
export type BankTxMatchDetail =
  | {
      kind: 'manual';
      /** 'load' (carga) | 'unload' (retiro manual). */
      movementType: string;
      amount: string;
      reason: string | null;
      source: string | null;
      createdAt: string;
      playerUsername: string | null;
      playerName: string | null;
    }
  | {
      kind: 'deposit' | 'withdrawal';
      amountChips: string;
      status: string;
      createdAt: string;
      playerUsername: string | null;
      playerName: string | null;
    }
  | { kind: 'capital_injection'; id: string }
  | null;

export interface BankTxWithMatch extends BankTransaction {
  matchedByUsername: string | null;
  matchDetail: BankTxMatchDetail;
}

/** Detalle enriquecido de una transferencia (para el drawer). */
export function useBankTransactionDetail(id: string | null) {
  return useQuery({
    queryKey: ['bank-tx-detail', id],
    enabled: id !== null,
    queryFn: () =>
      apiGet<BankTxWithMatch>(`/tenant/bank-transactions/${id}/detail`),
  });
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
  /** Búsqueda libre por nombre de la contraparte (quien envía/recibe). */
  search?: string;
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

export function useBankTransactions(
  filters: BankTxFilters = {},
  options?: { refetchInterval?: number | false; enabled?: boolean },
) {
  return useQuery({
    queryKey: ['bank-tx-list', filters],
    queryFn: () => apiGet<ListResponse>(`/tenant/bank-transactions${qs(filters)}`),
    staleTime: 15_000,
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval,
  });
}

export function useUnmatchedForAmount(
  amount: string,
  includeAll = false,
  direction: BankTxDirection = 'incoming',
  options?: { refetchInterval?: number | false },
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
    refetchInterval: options?.refetchInterval,
  });
}

export interface UploadBankTxPayload {
  /**
   * Sprint 53: opcional — solo se exige para entrantes (matcher del
   * deposit). Para salientes con comprobante puede omitirse.
   */
  bankAccount?: string;
  amount: string;
  currency?: string;
  /** Sprint 51: 'incoming' (default) o 'outgoing'. */
  direction?: BankTxDirection;
  /** Sprint 54: titular + banco de la cuenta propia usada. */
  accountHolder?: string;
  bankName?: string;
  senderName?: string;
  senderCbu?: string;
  reference?: string;
  /**
   * Sprint 52: comprobante. OBLIGATORIO para direction='outgoing' (el
   * backend devuelve 400 BANK_TX_OUTGOING_RECEIPT_REQUIRED si falta).
   */
  receiptUrl?: string;
  receiptStorageKey?: string;
  /** Sprint 55: SHA-256 del contenido (lo devuelve /upload-proof). */
  receiptHash?: string;
  receivedAt: string;
  notes?: string;
}

function invalidate(qc: ReturnType<typeof useQueryClient>): void {
  qc.invalidateQueries({ queryKey: ['bank-tx-list'] });
  qc.invalidateQueries({ queryKey: ['bank-tx-unmatched'] });
}

// ──────────────────────────────────────────────────────────────────────
// Optimistic updates (Fase B)
//
// El botón Aprobar (depósitos) / Marcar pagado (retiros) depende de
// `bankTransactionId` del detalle/listas. Sin esto, matchear y después
// querer aprobar requería esperar el refetch de invalidación (o recargar
// la página). Escribimos el cache al instante.
// ──────────────────────────────────────────────────────────────────────

interface DepositListData {
  data: DepositRow[];
  total: number;
}

interface WithdrawalListData {
  data: WithdrawalRow[];
  total: number;
}

function applyDepositMatchOptimistic(
  qc: ReturnType<typeof useQueryClient>,
  depositId: string,
  bankTxId: string | null,
): void {
  // Detalle del drawer abierto → habilita Aprobar al instante.
  qc.setQueryData<DepositDetailResponse>(
    ['deposit-detail', depositId],
    (old) =>
      old
        ? { ...old, deposit: { ...old.deposit, bankTransactionId: bankTxId } }
        : old,
  );
  // Filas en las listas cacheadas (tabla review).
  qc.setQueriesData<DepositListData>(
    { queryKey: ['deposits'] },
    (old) => {
      if (!old) return old;
      return {
        ...old,
        data: old.data.map((d) =>
          d.id === depositId ? { ...d, bankTransactionId: bankTxId } : d,
        ),
      };
    },
  );
}

function applyWithdrawalMatchOptimistic(
  qc: ReturnType<typeof useQueryClient>,
  withdrawalId: string,
  bankTxId: string | null,
): void {
  // Detalle del drawer abierto → habilita Marcar pagado al instante.
  qc.setQueryData<WithdrawalDetailResponse>(
    ['withdrawal-detail', withdrawalId],
    (old) =>
      old
        ? {
            ...old,
            withdrawal: { ...old.withdrawal, bankTransactionId: bankTxId },
          }
        : old,
  );
  // Filas en las listas cacheadas (tabla review).
  qc.setQueriesData<WithdrawalListData>(
    { queryKey: ['withdrawals'] },
    (old) => {
      if (!old) return old;
      return {
        ...old,
        data: old.data.map((w) =>
          w.id === withdrawalId ? { ...w, bankTransactionId: bankTxId } : w,
        ),
      };
    },
  );
}

/**
 * Unmatch: el endpoint recibe solo bankTxId, así que buscamos en las
 * listas cacheadas qué depósito/retiro tenía esa bank_tx y limpiamos.
 */
function clearMatchOptimistic(
  qc: ReturnType<typeof useQueryClient>,
  bankTxId: string,
): void {
  const depositQueries = qc.getQueriesData<DepositListData>({
    queryKey: ['deposits'],
  });
  for (const [, data] of depositQueries) {
    const hit = data?.data.find((d) => d.bankTransactionId === bankTxId);
    if (hit) {
      applyDepositMatchOptimistic(qc, hit.id, null);
      break;
    }
  }
  const withdrawalQueries = qc.getQueriesData<WithdrawalListData>({
    queryKey: ['withdrawals'],
  });
  for (const [, data] of withdrawalQueries) {
    const hit = data?.data.find((w) => w.bankTransactionId === bankTxId);
    if (hit) {
      applyWithdrawalMatchOptimistic(qc, hit.id, null);
      break;
    }
  }
}

export function useUploadBankTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: UploadBankTxPayload) =>
      apiPost<BankTransaction>('/tenant/bank-transactions', payload),
    onSuccess: () => invalidate(qc),
  });
}

// ──────────────────────────────────────────────────────────────────────
// Sprint 52: upload de comprobante (two-step, igual que deposits)
// ──────────────────────────────────────────────────────────────────────

export interface UploadBankTxProofResponse {
  receiptUrl: string;
  receiptStorageKey: string;
  /** Sprint 55: SHA-256 del contenido — token de dedupe real por archivo. */
  receiptHash: string;
  sizeBytes: number;
}

/**
 * Sube el comprobante via multipart/form-data. El cliente lo llama antes
 * del submit de la bank_tx saliente (o del pay-in-full) y recibe
 * `{ receiptUrl, receiptStorageKey }` para mandar en el payload. Requiere
 * `bank_tx.upload`.
 */
export function useUploadBankTxProof() {
  return useMutation({
    mutationFn: async (file: File): Promise<UploadBankTxProofResponse> => {
      const fd = new FormData();
      fd.append('file', file);
      return apiUpload<UploadBankTxProofResponse>(
        '/tenant/bank-transactions/upload-proof',
        fd,
      );
    },
  });
}

/** Campos editables de una transferencia sin matchear (patch parcial). */
export interface UpdateBankTxPayload {
  bankAccount?: string;
  amount?: string;
  currency?: string;
  direction?: BankTxDirection;
  accountHolder?: string;
  bankName?: string;
  senderName?: string;
  senderCbu?: string;
  reference?: string;
  receiptUrl?: string;
  receiptStorageKey?: string;
  /** Sprint 55: SHA-256 del contenido (lo devuelve /upload-proof). */
  receiptHash?: string;
  receivedAt?: string;
  notes?: string;
}

/**
 * Edita una transferencia AÚN sin matchear (PATCH). El backend exige
 * `bank_tx.edit` y rechaza con 409 si ya está matcheada.
 */
export function useUpdateBankTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { id: string; payload: UpdateBankTxPayload }) =>
      apiPatch<BankTransaction>(
        `/tenant/bank-transactions/${params.id}`,
        params.payload,
      ),
    onSuccess: () => invalidate(qc),
  });
}

/**
 * Borra una transferencia AÚN sin matchear (DELETE). El backend exige
 * `bank_tx.delete` y rechaza con 409 si ya está matcheada.
 */
export function useDeleteBankTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiDelete<void>(`/tenant/bank-transactions/${id}`),
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
    // Optimistic: escribir el match en el cache YA para que el botón
    // Aprobar se habilite al instante, sin esperar el refetch.
    onMutate: (variables) => {
      const prevDetail = qc.getQueryData<DepositDetailResponse>([
        'deposit-detail',
        variables.depositId,
      ]);
      applyDepositMatchOptimistic(qc, variables.depositId, variables.bankTxId);
      return { prevDetail };
    },
    onError: (_err, variables, context) => {
      // Rollback del optimistic al estado previo.
      if (context?.prevDetail) {
        qc.setQueryData(
          ['deposit-detail', variables.depositId],
          context.prevDetail,
        );
      }
      invalidate(qc);
      qc.invalidateQueries({ queryKey: ['deposits'] });
      qc.invalidateQueries({ queryKey: ['deposit-detail', variables.depositId] });
    },
    onSuccess: (_data, variables) => {
      invalidate(qc);
      qc.invalidateQueries({ queryKey: ['deposits'] });
      // Fase B: el detalle abierto en un drawer puede tener la bank_tx
      // vieja (staleTime 15s) — invalidar para que el match se vea YA.
      qc.invalidateQueries({ queryKey: ['deposit-detail', variables.depositId] });
    },
  });
}

export function useUnmatchBankTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (bankTxId: string) =>
      apiPost<BankTransaction>(`/tenant/bank-transactions/${bankTxId}/unmatch`, {}),
    // Optimistic: limpiar el match en el cache YA para que Aprobar/
    // Marcar pagado se deshabiliten al instante.
    onMutate: (bankTxId) => {
      clearMatchOptimistic(qc, bankTxId);
    },
    onError: () => {
      invalidate(qc);
      qc.invalidateQueries({ queryKey: ['deposits'] });
      qc.invalidateQueries({ queryKey: ['withdrawals'] });
    },
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
    // Optimistic: escribir el match en el cache YA para que Marcar
    // pagado se habilite al instante.
    onMutate: (variables) => {
      const prevDetail = qc.getQueryData<WithdrawalDetailResponse>([
        'withdrawal-detail',
        variables.withdrawalId,
      ]);
      applyWithdrawalMatchOptimistic(
        qc,
        variables.withdrawalId,
        variables.bankTxId,
      );
      return { prevDetail };
    },
    onError: (_err, variables, context) => {
      // Rollback del optimistic al estado previo.
      if (context?.prevDetail) {
        qc.setQueryData(
          ['withdrawal-detail', variables.withdrawalId],
          context.prevDetail,
        );
      }
      invalidate(qc);
      qc.invalidateQueries({ queryKey: ['withdrawals'] });
      qc.invalidateQueries({
        queryKey: ['withdrawal-detail', variables.withdrawalId],
      });
    },
    onSuccess: (_data, variables) => {
      invalidate(qc);
      qc.invalidateQueries({ queryKey: ['withdrawals'] });
      // Fase B: el drawer del retiro debe ver el match al instante.
      qc.invalidateQueries({ queryKey: ['withdrawal-detail', variables.withdrawalId] });
    },
  });
}

export interface UnmatchedManualRow {
  id: string;
  amount: string;
  createdAt: string;
  reason: string | null;
  ownerUsername: string;
  ownerDisplayName: string;
}

/**
 * Cargas ('incoming'→load) o retiros ('outgoing'→unload) MANUALES sin conciliar.
 * Candidatos para conciliar con una transferencia bancaria.
 */
export function useUnmatchedManual(
  direction: BankTxDirection,
  amount?: string,
  search?: string,
  options?: { enabled?: boolean; refetchInterval?: number | false },
) {
  return useQuery({
    queryKey: ['bank-tx-unmatched-manual', direction, amount ?? '', search ?? ''],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('direction', direction);
      if (amount) params.set('amount', amount);
      if (search) params.set('search', search);
      return apiGet<{ data: UnmatchedManualRow[] }>(
        `/tenant/bank-transactions/unmatched-manual?${params.toString()}`,
      );
    },
    enabled: options?.enabled ?? true,
    staleTime: 5_000,
    refetchInterval: options?.refetchInterval,
  });
}

/** Concilia una transferencia con una carga (incoming) o retiro (outgoing) manual. */
export function useMatchBankTransactionManual() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      bankTxId: string;
      walletTxId: string;
      payload?: MatchPayload;
    }) =>
      apiPost<BankTransaction>(
        `/tenant/bank-transactions/${params.bankTxId}/match-manual/${params.walletTxId}`,
        params.payload ?? {},
      ),
    onSuccess: () => {
      invalidate(qc);
      qc.invalidateQueries({ queryKey: ['bank-tx-unmatched-manual'] });
      qc.invalidateQueries({ queryKey: ['wallet-stats-movements'] });
    },
  });
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

/**
 * Balance por cuenta propia: entrantes − salientes de TODO lo cargado
 * (matched + unmatched, excluye disputed). Decisión dueño 2026-08-14.
 */
export function useBankAccountBalances(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['bank-tx-balances'],
    queryFn: () => apiGet<{ data: BankAccountBalance[] }>('/tenant/bank-transactions/balances'),
    enabled: options?.enabled ?? true,
    staleTime: 15_000,
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
