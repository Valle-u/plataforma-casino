/**
 * Hooks de wallet del user logueado.
 *
 * `useMyWallet` — `GET /tenant/wallet/me` (balance, currency, version).
 * `useMyTransactions(limit, offset)` — `GET /tenant/wallet/me/transactions`.
 * `useMint` — `POST /tenant/wallet/mint` (crear fichas).
 * `useBurn` — `POST /tenant/wallet/burn` (destruir fichas).
 *
 * Idempotency: las mutations generan automáticamente un UUID v4 para el
 * header `Idempotency-Key`. Si querés que una operación específica sea
 * retryable con la misma key (e.g. doble click del botón), persistir la
 * key generada en estado y reusarla en el retry.
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../api-client';

export interface WalletView {
  id: string;
  userId: string;
  balance: string;
  lockedBalance: string;
  currency: string;
  version: number;
  updatedAt: string;
}

export interface WalletTransaction {
  id: string;
  type: string;
  amount: string;
  balanceAfter: string;
  reason: string | null;
  createdAt: string;
}

interface TransactionsResponse {
  data: WalletTransaction[];
  total: number;
}

export function useMyWallet() {
  return useQuery({
    queryKey: ['my-wallet'],
    queryFn: () => apiGet<WalletView>('/tenant/wallet/me'),
    staleTime: 10_000, // balance cambia con cada operación, mantener fresco
  });
}

export function useMyTransactions(limit = 50, offset = 0) {
  return useQuery({
    queryKey: ['my-transactions', limit, offset],
    queryFn: () =>
      apiGet<TransactionsResponse>(
        `/tenant/wallet/me/transactions?limit=${limit}&offset=${offset}`,
      ),
    staleTime: 10_000,
  });
}

// ──────────────────────────────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────────────────────────────

export interface MintBurnPayload {
  /** Monto en chips, formato decimal string (e.g. "100.50"). */
  amount: string;
  /** Motivo obligatorio para audit. */
  reason: string;
  /** Referencia externa opcional (ID de operación bancaria, etc.). */
  referenceId?: string;
  notes?: string;
  /** Código 2FA si el actor lo tiene enabled. */
  twoFaCode?: string;
}

interface MintBurnResponse {
  ok: true;
  transaction: WalletTransaction & { idempotencyKey: string | null };
  wallet: WalletView;
}

/**
 * Genera una idempotency-key UUID v4. Browser-native (crypto.randomUUID).
 * El backend la persiste con UNIQUE constraint en wallet_transactions.
 */
function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback: random hex de 32 chars (improbable colisión).
  return Array.from({ length: 32 })
    .map(() => Math.floor(Math.random() * 16).toString(16))
    .join('');
}

export function useMint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: MintBurnPayload) =>
      apiPost<MintBurnResponse>('/tenant/wallet/mint', payload, {
        idempotencyKey: generateIdempotencyKey(),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-wallet'] });
      qc.invalidateQueries({ queryKey: ['my-transactions'] });
    },
  });
}

export function useBurn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: MintBurnPayload) =>
      apiPost<MintBurnResponse>('/tenant/wallet/burn', payload, {
        idempotencyKey: generateIdempotencyKey(),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-wallet'] });
      qc.invalidateQueries({ queryKey: ['my-transactions'] });
    },
  });
}
