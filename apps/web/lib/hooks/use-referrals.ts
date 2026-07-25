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
