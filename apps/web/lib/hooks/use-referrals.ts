'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch, apiPost } from '../api-client';

export interface ReferralCodeInfo {
  /** null si el usuario no tiene código base (ej. admin). */
  code: string | null;
  link: string | null;
  generatedAt: string | null;
}

export interface ReferralMyStats {
  totalClicks: number;
  totalSignups: number;
}

export interface ReferralMetricsDay {
  date: string;
  clicks: number;
  signups: number;
}

export interface ReferralMetricsResult {
  period: ReferralMetricsDay[];
  summary: {
    totalClicks: number;
    totalSignups: number;
    conversionRate: number;
    /** Usuarios referidos con ≥1 depósito aprobado (first-time depositors). */
    ftds: number;
  };
}

export interface ReferredUser {
  id: string;
  username: string;
  displayName: string;
  attributedAt: string;
  status: string;
}

export interface ReferredUsersResult {
  users: ReferredUser[];
  total: number;
  page: number;
  limit: number;
}

/** Un código (base o campaña) con métricas agregadas. */
export interface ReferralCodeListItem {
  /** null = código base. uuid = campaña. */
  id: string | null;
  code: string;
  label: string;
  isActive: boolean;
  isBase: boolean;
  link: string;
  clicks: number;
  signups: number;
  /** Usuarios referidos por este código con ≥1 depósito aprobado. */
  ftds: number;
  createdAt: string | null;
}

export interface MyReferralCodesResult {
  base: ReferralCodeListItem | null;
  campaigns: ReferralCodeListItem[];
  campaignCap: number;
}

export function useReferralCode() {
  return useQuery<ReferralCodeInfo>({
    queryKey: ['referrals', 'my-code'],
    queryFn: () => apiGet('/tenant/referrals/my-code'),
    staleTime: 60_000,
  });
}

/** Lista de códigos del usuario (base + campañas) con métricas por código. */
export function useReferralCodes() {
  return useQuery<MyReferralCodesResult>({
    queryKey: ['referrals', 'my-codes'],
    queryFn: () => apiGet('/tenant/referrals/my-codes'),
    staleTime: 30_000,
  });
}

/** Crea una campaña (solo etiqueta; el código se auto-genera en el backend). */
export function useCreateReferralCode() {
  const qc = useQueryClient();
  return useMutation<ReferralCodeListItem, Error, { label: string }>({
    mutationFn: (body) => apiPost('/tenant/referrals/codes', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['referrals', 'my-codes'] });
    },
  });
}

/** Renombra la etiqueta y/o (des)activa una campaña. */
export function useUpdateReferralCode() {
  const qc = useQueryClient();
  return useMutation<
    ReferralCodeListItem,
    Error,
    { id: string; label?: string; isActive?: boolean }
  >({
    mutationFn: ({ id, ...patch }) =>
      apiPatch(`/tenant/referrals/codes/${id}`, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['referrals', 'my-codes'] });
    },
  });
}

export function useReferralStats() {
  return useQuery<ReferralMyStats>({
    queryKey: ['referrals', 'my-stats'],
    queryFn: () => apiGet('/tenant/referrals/my-stats'),
    staleTime: 30_000,
  });
}

/** Métricas time-series. Si `code` viene, filtra por ese código (drill-down). */
export function useReferralMetrics(days: number, code?: string | null) {
  return useQuery<ReferralMetricsResult>({
    queryKey: ['referrals', 'my-metrics', days, code ?? null],
    queryFn: () =>
      apiGet(
        `/tenant/referrals/my-metrics?days=${days}${
          code ? `&code=${encodeURIComponent(code)}` : ''
        }`,
      ),
    staleTime: 30_000,
  });
}

/** Usuarios referidos. Si `code` viene, filtra por ese código (drill-down). */
export function useReferredUsers(
  page: number,
  limit = 20,
  code?: string | null,
) {
  return useQuery<ReferredUsersResult>({
    queryKey: ['referrals', 'my-referred-users', page, limit, code ?? null],
    queryFn: () =>
      apiGet(
        `/tenant/referrals/my-referred-users?page=${page}&limit=${limit}${
          code ? `&code=${encodeURIComponent(code)}` : ''
        }`,
      ),
    staleTime: 30_000,
  });
}
