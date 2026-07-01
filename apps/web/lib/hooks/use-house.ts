/**
 * Hook del panel de Tesorería / Casa (Blindaje núcleo económico, Parte B).
 *
 * Endpoint (requiere house.view):
 *   - GET /tenant/house → estado de la Casa (balance, bloqueado).
 *
 * Devuelve 404 HOUSE_NOT_PROVISIONED si el tenant todavía no tiene la Casa
 * provisionada (seed viejo) — la página lo maneja con un estado dedicado.
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch, apiPost } from '../api-client';

export interface HouseState {
  userId: string;
  username: string;
  displayName: string;
  /** Fichas disponibles de la Casa. */
  balance: string;
  /** Fichas bloqueadas de la Casa (holds). */
  lockedBalance: string;
}

export function useHouseState() {
  return useQuery({
    queryKey: ['house-state'],
    queryFn: () => apiGet<HouseState>('/tenant/house'),
    staleTime: 15_000,
    retry: false, // un 404 (no provisionada) no se reintenta.
  });
}

// ──────────────────────────────────────────────────────────────────────
// Aportes de capital (B-build-3)
// ──────────────────────────────────────────────────────────────────────

export interface HouseCapitalInjection {
  id: string;
  /** 'capital' (atado a bank_tx, estricto) | 'budget' (presupuesto, sin bank_tx). */
  type: 'capital' | 'budget';
  amount: string;
  /** Motivo del fondeo. Obligatorio en ambos tipos. */
  reason: string;
  /** NULL cuando type='budget'. */
  bankTransactionId: string | null;
  mintTxId: string | null;
  createdBy: string;
  notes: string | null;
  createdAt: string;
}

export function useCapitalInjections(limit = 50, offset = 0) {
  return useQuery({
    queryKey: ['house-capital-injections', limit, offset],
    queryFn: () =>
      apiGet<{ injections: HouseCapitalInjection[]; total: number }>(
        `/tenant/house/capital-injections?limit=${limit}&offset=${offset}`,
      ),
    staleTime: 15_000,
  });
}

/** Aporta capital a la Casa a partir de una transferencia entrante sin matchear. */
export function useInjectCapital() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { bankTransactionId: string; notes?: string }) =>
      apiPost<HouseCapitalInjection>('/tenant/house/inject-capital', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['house-state'] });
      qc.invalidateQueries({ queryKey: ['house-capital-injections'] });
      qc.invalidateQueries({ queryKey: ['bank-tx-list'] });
      qc.invalidateQueries({ queryKey: ['ledger-supply'] });
      qc.invalidateQueries({ queryKey: ['audit-log'] });
    },
  });
}

/**
 * Fondea PRESUPUESTO a la Casa (docs/16 §12) — sin bank_tx, motivo obligatorio.
 * El admin fija el monto y el motivo directo. Modelo "banco central".
 */
export function useInjectBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { amount: string; reason: string; notes?: string }) =>
      apiPost<HouseCapitalInjection>('/tenant/house/inject-budget', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['house-state'] });
      qc.invalidateQueries({ queryKey: ['house-capital-injections'] });
      qc.invalidateQueries({ queryKey: ['ledger-supply'] });
      qc.invalidateQueries({ queryKey: ['audit-log'] });
    },
  });
}

// ──────────────────────────────────────────────────────────────────────
// Topes de apuesta (B-build-4b)
// ──────────────────────────────────────────────────────────────────────

export interface BettingCapsStatus {
  caps: { playerMonthly: number; globalMonthly: number };
  turnover: { player: string; global: string };
  periodStart: string;
}

export function useBettingCaps() {
  return useQuery({
    queryKey: ['betting-caps'],
    queryFn: () => apiGet<BettingCapsStatus>('/tenant/house/betting-caps'),
    staleTime: 15_000,
  });
}

export function useSetBettingCaps() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { playerMonthly: number; globalMonthly: number }) =>
      apiPatch<BettingCapsStatus>('/tenant/house/betting-caps', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['betting-caps'] });
      qc.invalidateQueries({ queryKey: ['audit-log'] });
    },
  });
}
