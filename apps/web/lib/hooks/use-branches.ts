/**
 * Hooks Sprint 51 — modo sucursal independiente para socios.
 *
 * Endpoints (ambos admin-only, no delegables):
 *   - POST /tenant/users/:id/branch/toggle-independence  (branch.toggle_independence)
 *   - POST /tenant/users/:id/branch/sell-chips           (branch.sell_chips)
 */

'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost } from '../api-client';

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
      qc.invalidateQueries({ queryKey: ['wallet-detail', socioId] });
      qc.invalidateQueries({ queryKey: ['my-wallet'] });
    },
  });
}
