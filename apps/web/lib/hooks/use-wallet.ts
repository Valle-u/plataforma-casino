/**
 * Hooks de wallet del user logueado.
 *
 * `useMyWallet` — `GET /tenant/wallet/me` (balance, currency, version).
 * `useMyTransactions(limit, offset)` — `GET /tenant/wallet/me/transactions`.
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
import { invalidateAllBalances } from '../query-balances';

export interface WalletView {
  id: string;
  userId: string;
  balance: string;
  bonusBalance: string;
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

/**
 * `useMyWallet` — balance del player logueado.
 *
 * Sprint 51.16 — staleness fix: el balance puede cambiar por causas que
 * esta sesión no conoce (cajero cargando chips, otro tab del mismo player
 * abriendo un juego, ajustes admin, premios autograntados por jobs). Para
 * que el número en pantalla refleje la realidad sin obligar al usuario a
 * refrescar, agregamos:
 *
 *   - `refetchInterval: 20_000`  → polling cada 20s mientras el tab esté
 *     activo. 20s es el sweet-spot entre "se siente vivo" y "no spammeo
 *     el backend de 100 jugadores".
 *   - `refetchIntervalInBackground: false` → si el tab está oculto, no
 *     polleamos (ahorra batería + carga). Cuando vuelve al foco, dispara
 *     el siguiente fetch.
 *   - `refetchOnWindowFocus: true` → al volver al tab, refresca YA (el
 *     escenario clásico "vengo del WhatsApp del cajero a chequear").
 *   - `refetchOnReconnect: true` → si se reconecta la red, también.
 *   - `staleTime: 5_000` → bajado de 10s a 5s: muchas acciones disparan
 *     invalidate y queremos que el primer paint sea fresco.
 */
export function useMyWallet() {
  return useQuery({
    queryKey: ['my-wallet'],
    queryFn: () => apiGet<WalletView>('/tenant/wallet/me'),
    staleTime: 5_000,
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
  });
}

/**
 * `useMyTransactions` — feed de movimientos. Mismo problema/solución que
 * el wallet pero con polling más lento (30s) porque la lista es menos
 * crítica de ver "al instante" que el saldo.
 */
export function useMyTransactions(limit = 50, offset = 0) {
  return useQuery({
    queryKey: ['my-transactions', limit, offset],
    queryFn: () =>
      apiGet<TransactionsResponse>(
        `/tenant/wallet/me/transactions?limit=${limit}&offset=${offset}`,
      ),
    staleTime: 5_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
  });
}

// Sprint 51.10: stats agregados del wallet del operador en ventana de N días.
export interface MyWalletStatsResponse {
  windowDays: number;
  totalTransactions: number;
  netChange: string;
  byType: Array<{ type: string; sum: string; count: number }>;
}

export function useMyWalletStats(windowDays = 7) {
  return useQuery({
    queryKey: ['my-wallet-stats', windowDays],
    queryFn: () =>
      apiGet<MyWalletStatsResponse>(
        `/tenant/wallet/me/stats?windowDays=${windowDays}`,
      ),
    // 30s — los stats no cambian con cada tx, una pequeña window de
    // staleness es OK y reduce carga.
    staleTime: 30_000,
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

export function useBurn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: MintBurnPayload) =>
      apiPost<MintBurnResponse>('/tenant/wallet/burn', payload, {
        idempotencyKey: generateIdempotencyKey(),
      }),
    onSuccess: () => {
      invalidateAllBalances(qc);
    },
  });
}

// ──────────────────────────────────────────────────────────────────────
// Wallet de OTRO user (admin / cajero viendo wallet de jugador)
// ──────────────────────────────────────────────────────────────────────

export function useUserWallet(userId: string | null) {
  return useQuery({
    queryKey: ['user-wallet', userId],
    queryFn: () => apiGet<WalletView>(`/tenant/wallet/user/${userId}`),
    enabled: !!userId,
    staleTime: 10_000,
    // El balance del jugador cambia por fuentes que esta sesión no conoce
    // (juego en curso, depósitos, otro tab). Mismo polling que la lista.
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

export function useUserTransactions(userId: string | null, limit = 50, offset = 0) {
  return useQuery({
    queryKey: ['user-transactions', userId, limit, offset],
    queryFn: () =>
      apiGet<TransactionsResponse>(
        `/tenant/wallet/user/${userId}/transactions?limit=${limit}&offset=${offset}`,
      ),
    enabled: !!userId,
    staleTime: 10_000,
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

// ──────────────────────────────────────────────────────────────────────
// Load / Unload (transferencia entre actor y target user)
// ──────────────────────────────────────────────────────────────────────

export interface LoadUnloadPayload {
  targetUserId: string;
  amount: string;
  /** Reason obligatorio para audit. */
  reason: string;
  notes?: string;
}

interface TransferResponse {
  ok: true;
  sourceTransaction: {
    id: string;
    type: string;
    amount: string;
    balanceAfter: string;
    createdAt: string;
  };
  targetTransaction: {
    id: string;
    type: string;
    amount: string;
    balanceAfter: string;
    createdAt: string;
  };
  sourceWallet: WalletView;
  targetWallet: WalletView;
}

/**
 * Load/Unload mueven chips entre el actor y el target: refresca TODOS los
 * balances (el del actor, el del target vía prefijo user-wallet, la Casa
 * cuando corresponde, la lista de users y KPIs).
 */
export function useLoad() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: LoadUnloadPayload) =>
      apiPost<TransferResponse>('/tenant/wallet/load', payload, {
        idempotencyKey: generateIdempotencyKey(),
      }),
    onSuccess: () => invalidateAllBalances(qc),
  });
}

/**
 * `useUnload` — el actor RETIRA chips desde la wallet del target hacia
 * su propia wallet. Reason obligatorio (regla del backend).
 */
export function useUnload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: LoadUnloadPayload) =>
      apiPost<TransferResponse>('/tenant/wallet/unload', payload, {
        idempotencyKey: generateIdempotencyKey(),
      }),
    onSuccess: () => invalidateAllBalances(qc),
  });
}
