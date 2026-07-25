'use client';

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../api-client';

export interface ReferralCodeInfo {
  code: string;
  link: string;
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

export function useReferralCode() {
  return useQuery<ReferralCodeInfo>({
    queryKey: ['referrals', 'my-code'],
    queryFn: () => apiGet('/tenant/referrals/my-code'),
    staleTime: 60_000,
  });
}

export function useReferralStats() {
  return useQuery<ReferralMyStats>({
    queryKey: ['referrals', 'my-stats'],
    queryFn: () => apiGet('/tenant/referrals/my-stats'),
    staleTime: 30_000,
  });
}

export function useReferralMetrics(days: number) {
  return useQuery<ReferralMetricsResult>({
    queryKey: ['referrals', 'my-metrics', days],
    queryFn: () => apiGet(`/tenant/referrals/my-metrics?days=${days}`),
    staleTime: 30_000,
  });
}

export function useReferredUsers(page: number, limit = 20) {
  return useQuery<ReferredUsersResult>({
    queryKey: ['referrals', 'my-referred-users', page, limit],
    queryFn: () =>
      apiGet(`/tenant/referrals/my-referred-users?page=${page}&limit=${limit}`),
    staleTime: 30_000,
  });
}
