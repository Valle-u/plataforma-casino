/**
 * Hooks player-facing del módulo responsible-gaming (Sprint 33).
 *
 * Endpoints (sin permission especial, solo TenantJwtGuard):
 *   - GET  /tenant/responsible-gaming/me
 *   - PUT  /tenant/responsible-gaming/me
 *   - GET  /tenant/responsible-gaming/me/exclusion
 *   - POST /tenant/responsible-gaming/me/exclude
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch, apiPost } from '../api-client';

export type LossLimitPeriodUnit = 'day' | 'week' | 'month';
export type SelfExclusionType = 'cool_off' | 'temporary' | 'permanent';
export type SelfExclusionStatus = 'active' | 'expired' | 'revoked';

export interface RgSettings {
  userId: string;
  depositLimitDaily: string | null;
  depositLimitWeekly: string | null;
  depositLimitMonthly: string | null;
  betLimitPerRound: string | null;
  lossLimitPeriod: string | null;
  lossLimitPeriodUnit: LossLimitPeriodUnit | null;
  ageConfirmedAt: string | null;
  ageConfirmedMin: number | null;
  updatedByUserId: string | null;
  updatedByReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SelfExclusion {
  id: string;
  userId: string;
  type: SelfExclusionType;
  startsAt: string;
  endsAt: string | null;
  reason: string | null;
  createdByUserId: string | null;
  revokedByUserId: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  status: SelfExclusionStatus;
  createdAt: string;
}

interface MyResponse {
  settings: RgSettings | null;
  exclusion: SelfExclusion | null;
}

export function useMyResponsibleGaming() {
  return useQuery({
    queryKey: ['rg-me'],
    queryFn: () => apiGet<MyResponse>('/tenant/responsible-gaming/me'),
    staleTime: 30_000,
  });
}

export interface UpsertLimitsPayload {
  depositLimitDaily?: string | null;
  depositLimitWeekly?: string | null;
  depositLimitMonthly?: string | null;
  betLimitPerRound?: string | null;
  lossLimitPeriod?: string | null;
  lossLimitPeriodUnit?: LossLimitPeriodUnit | null;
}

function invalidate(qc: ReturnType<typeof useQueryClient>): void {
  qc.invalidateQueries({ queryKey: ['rg-me'] });
}

export function useUpsertMyLimits() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpsertLimitsPayload) =>
      apiPatch<RgSettings>('/tenant/responsible-gaming/me', payload),
    onSuccess: () => invalidate(qc),
  });
}

export interface SelfExcludePayload {
  type: SelfExclusionType;
  /** ISO date. Requerido para cool_off/temporary; ignorado para permanent. */
  endsAt?: string;
  reason?: string;
}

export function useSelfExclude() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: SelfExcludePayload) =>
      apiPost<SelfExclusion>(
        '/tenant/responsible-gaming/me/exclude',
        payload,
      ),
    onSuccess: () => invalidate(qc),
  });
}
