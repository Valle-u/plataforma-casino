/**
 * Hooks Sprint 51 — modo sucursal independiente para socios.
 *
 * Endpoints (ambos admin-only, no delegables):
 *   - POST /tenant/users/:id/branch/toggle-independence  (branch.toggle_independence)
 *   - POST /tenant/users/:id/branch/sell-chips           (branch.sell_chips)
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../api-client';
import { invalidateAllBalances } from '../query-balances';

export interface ToggleIndependencePayload {
  isIndependent: boolean;
  branchBankAccount?: string;
  branchChipsPricePerUnit?: string;
}

interface ToggleIndependenceResponse {
  user: {
    id: string;
    isIndependentBranch: boolean;
    branchBankAccount: string | null;
    branchChipsPricePerUnit: string | null;
  };
}

export function useToggleBranchIndependence(socioId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ToggleIndependencePayload) => {
      if (!socioId) throw new Error('socioId requerido');
      return apiPost<ToggleIndependenceResponse>(
        `/tenant/users/${socioId}/branch/toggle-independence`,
        payload,
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-detail', socioId] });
      qc.invalidateQueries({ queryKey: ['users-list'] });
    },
  });
}

export interface SellChipsPayload {
  amountChips: string;
  /** Total $ cobrado al socio. Opcional: si no viene, el backend usa el
   *  precio configurado (pricePerUnit = amountFiat / amountChips). */
  amountFiat?: string;
  idempotencyKey?: string;
  notes?: string;
}

export interface SellChipsResponse {
  socioId: string;
  amountChips: string;
  pricePerUnit: string;
  amountFiat: string;
  walletTxId: string;
  newBalance: string;
}

export function useSellBranchChips(socioId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: SellChipsPayload) => {
      if (!socioId) throw new Error('socioId requerido');
      return apiPost<SellChipsResponse>(
        `/tenant/users/${socioId}/branch/sell-chips`,
        payload,
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-detail', socioId] });
      qc.invalidateQueries({ queryKey: ['branches-list'] });
      qc.invalidateQueries({ queryKey: ['branches-sales-history'] });
      qc.invalidateQueries({ queryKey: ['my-branch'] });
      // Sell-chips debita la caja del socio y acredita la del admin:
      // refresca todos los balances en el momento (incluye la wallet del
      // socio, antes apuntada a la key muerta ['wallet-detail']).
      invalidateAllBalances(qc);
    },
  });
}

// ──────────────────────────────────────────────────────────────────────
// Sprint 51.1 — listado + reporting + self-view
// ──────────────────────────────────────────────────────────────────────

export interface BranchListRow {
  socioId: string;
  username: string;
  displayName: string;
  status: string;
  branchBankAccount: string;
  branchChipsPricePerUnit: string;
  walletBalance: string;
  chipsSold30d: string;
  fiatSold30d: string;
  lastSaleAt: string | null;
}

export function useBranchesList() {
  return useQuery({
    queryKey: ['branches-list'],
    queryFn: () => apiGet<{ data: BranchListRow[] }>('/tenant/branches'),
    staleTime: 30_000,
  });
}

export interface BranchSalesSummaryRow {
  socioId: string;
  username: string;
  displayName: string;
  branchChipsPricePerUnit: string | null;
  salesCount: number;
  totalChipsSold: string;
  totalFiatSold: string;
  lastSaleAt: string | null;
}

export interface BranchSalesSummary {
  data: BranchSalesSummaryRow[];
  totals: {
    salesCount: number;
    totalChipsSold: string;
    totalFiatSold: string;
  };
}

export function useBranchSalesSummary(filters: { from?: string; to?: string } = {}) {
  return useQuery({
    queryKey: ['branches-sales-summary', filters],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters.from) params.set('from', filters.from);
      if (filters.to) params.set('to', filters.to);
      const qs = params.toString();
      return apiGet<BranchSalesSummary>(
        `/tenant/branches/sales-summary${qs ? `?${qs}` : ''}`,
      );
    },
    staleTime: 30_000,
  });
}

export interface BranchSaleEntry {
  walletTxId: string;
  amountChips: string;
  amountFiat: string;
  pricePerUnit: string;
  reason: string | null;
  createdAt: string;
  createdByUserId: string | null;
  createdByUsername: string | null;
}

export interface BranchSaleHistoryRow extends BranchSaleEntry {
  socioId: string;
  username: string;
  displayName: string;
}

export function useBranchSalesHistory(filters: {
  from?: string;
  to?: string;
} = {}) {
  return useQuery({
    queryKey: ['branches-sales-history', filters],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters.from) params.set('from', filters.from);
      if (filters.to) params.set('to', filters.to);
      const qs = params.toString();
      return apiGet<{ data: BranchSaleHistoryRow[] }>(
        `/tenant/branches/sales-history${qs ? `?${qs}` : ''}`,
      );
    },
    staleTime: 15_000,
  });
}

export interface MyBranchInfo {
  isIndependent: boolean;
  underIndependentBranch: boolean;
  independentBranchOwnerId: string | null;
  bankAccount: string | null;
  pricePerUnit: string | null;
  walletBalance: string;
  totals: {
    chipsSoldAllTime: string;
    fiatSoldAllTime: string;
    salesCount: number;
  };
  recentSales: BranchSaleEntry[];
}

export function useMyBranch(limit = 20) {
  return useQuery({
    queryKey: ['my-branch', { limit }],
    queryFn: () => apiGet<MyBranchInfo>(`/tenant/branches/mine?limit=${limit}`),
    staleTime: 15_000,
  });
}

// ── Flujo de fichas del operador (red independiente): compras + ventas ──────

export interface ChipFlowEntry {
  id: string;
  chips: string;
  fiat: string;
  pricePerUnit: string;
  counterpartyUserId: string | null;
  counterpartyUsername: string | null;
  counterpartyDisplayName: string | null;
  reason: string | null;
  createdAt: string;
}

export interface ChipFlowResult {
  pricePerUnit: string | null;
  totals: {
    comprasChips: string;
    comprasFiat: string;
    ventasChips: string;
    ventasFiat: string;
    margenEstimado: string;
    balance: string;
  };
  compras: ChipFlowEntry[];
  ventas: ChipFlowEntry[];
}

/** Flujo de fichas del operador logueado (compras recibidas + ventas a hijos). */
export function useMyChipFlow(limit = 50, enabled = true) {
  return useQuery({
    queryKey: ['my-chip-flow', { limit }],
    queryFn: () =>
      apiGet<ChipFlowResult>(`/tenant/branches/mine/chip-flow?limit=${limit}`),
    staleTime: 15_000,
    enabled,
  });
}
