/**
 * Hooks de comisiones por red (modelo socios-only, C4).
 *
 * La plataforma le paga al SOCIO su % × NetWin de toda su red. El admin fija el
 * % de cada socio, computa el período, y liquida (fichas o plata real).
 *
 * Endpoints:
 *   - GET   /tenant/commissions/network/socios          (commissions.configure)
 *   - PATCH /tenant/commissions/network-rate/:childId    (commissions.configure_network)
 *   - POST  /tenant/commissions/network/compute          (commissions.configure)
 *   - GET   /tenant/commissions/network/periods?period=  (commissions.view + scope)
 *   - POST  /tenant/commissions/network/settle           (commissions.settle)
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch, apiPost } from '../api-client';

export interface SocioRate {
  id: string;
  username: string;
  displayName: string | null;
  commissionRate: string;
  isIndependent: boolean;
}

export function useSocioRates() {
  return useQuery({
    queryKey: ['network-socios'],
    queryFn: () =>
      apiGet<{ socios: SocioRate[] }>('/tenant/commissions/network/socios'),
    staleTime: 20_000,
  });
}

export function useSetSocioRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { childUserId: string; rate: number }) =>
      apiPatch(`/tenant/commissions/network-rate/${payload.childUserId}`, {
        rate: payload.rate,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['network-socios'] });
      qc.invalidateQueries({ queryKey: ['audit-log'] });
    },
  });
}

export interface NetworkComputeResult {
  periodStart: string;
  periodEnd: string;
  sociosComputed: number;
  totalPayable: string;
  totalGross: string;
  totalNetWin: string;
  baseConsistency: { ok: boolean; nestedSocios: number };
}

export function useComputeNetwork() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { period?: string }) =>
      apiPost<NetworkComputeResult>(
        '/tenant/commissions/network/compute',
        payload,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['network-periods'] });
      qc.invalidateQueries({ queryKey: ['audit-log'] });
    },
  });
}

export interface NetworkPeriodRow {
  operatorUserId: string;
  operatorUsername: string | null;
  periodStart: string;
  periodEnd: string;
  subNetWin: string;
  grossCommission: string;
  carryoverIn: string;
  carryoverOut: string;
  payable: string;
  /** F1: costos que la Casa recupera del socio dep antes de pagar la comisión. */
  deductionsSalaries: string;
  deductionsBankCost: string;
  deductionsPlatformCost: string;
  /** F1: lo que realmente se liquida = MAX(0, payable − Σ deducciones). */
  finalCommission: string;
  rateSnapshot: string;
  status: string;
}

export function useNetworkPeriods(period: string | undefined) {
  return useQuery({
    queryKey: ['network-periods', period ?? 'all'],
    queryFn: () =>
      apiGet<{ periods: NetworkPeriodRow[] }>(
        `/tenant/commissions/network/periods${
          period ? `?period=${encodeURIComponent(period)}` : ''
        }`,
      ),
    staleTime: 15_000,
  });
}

export interface CommissionBreakdown {
  period: string;
  netWin: string;
  providerFee: string;
  base: string;
  rate: string;
  ownShare: string;
  childrenDeduction: string;
  gross: string;
  carryoverIn: string;
  payable: string;
  status?: 'accrued' | 'paid' | 'void';
  paidAt?: string | null;
}

export interface OperatorCommissionSummary {
  operator: {
    id: string;
    username: string;
    displayName: string;
    role: string;
    rate: string;
  };
  earnsCommission: boolean;
  current: CommissionBreakdown;
  history: CommissionBreakdown[];
}

/** Resumen de comisión del operador logueado (mi sucursal, Fase 2). */
export function useMyCommissionSummary() {
  return useQuery<OperatorCommissionSummary>({
    queryKey: ['my-commission-summary'],
    queryFn: () =>
      apiGet<OperatorCommissionSummary>('/tenant/commissions/my-summary'),
    staleTime: 30_000,
  });
}

export interface HousePnl {
  periodStart: string;
  periodEnd: string;
  periodComputed: boolean;
  dependent: {
    netWin: string;
    providerFee: string;
    base: string;
    commissions: string;
    houseNet: string;
  };
  independent: { netWin: string; providerFee: string };
  houseNetTotal: string;
}

/** P&L de la Casa por período (LEY C4b). */
export function useHousePnl(period: string | undefined) {
  return useQuery<HousePnl>({
    queryKey: ['house-pnl', period ?? 'default'],
    queryFn: () =>
      apiGet<HousePnl>(
        `/tenant/commissions/network/house-pnl${
          period ? `?period=${encodeURIComponent(period)}` : ''
        }`,
      ),
    staleTime: 15_000,
  });
}

export interface NetworkSettleResult {
  settled: number;
  failed: number;
  totalPaid: string;
  results: Array<{
    id: string;
    operatorUserId: string;
    amount: string;
    ok: boolean;
    error?: string;
  }>;
}

export function useSettleNetwork() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      rowIds?: string[];
      period?: string;
      reference?: string;
    }) =>
      apiPost<NetworkSettleResult>(
        '/tenant/commissions/network/settle',
        payload,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['network-periods'] });
      qc.invalidateQueries({ queryKey: ['house-state'] });
      qc.invalidateQueries({ queryKey: ['ledger-supply'] });
      qc.invalidateQueries({ queryKey: ['audit-log'] });
    },
  });
}
