/**
 * Hook del flujo de cargas por corrección/bonificación/reintegro (docs/19).
 *
 * Endpoints:
 *   - GET /tenant/correction/status → cupo del actor (cap, used, remaining).
 *   - POST /tenant/correction → aplica una corrección (drena la Casa).
 *   - PATCH /tenant/correction/user/:id/cap → admin fija el cupo de un empleado.
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch, apiPost } from '../api-client';

export type CorrectionReasonType = 'correction' | 'bonus' | 'refund' | 'other';

export interface CorrectionStatus {
  cap: string;
  used: string;
  remaining: string;
}

export interface CorrectionPayload {
  targetUserId: string;
  amount: string;
  reasonType: CorrectionReasonType;
  reasonNotes?: string;
}

export interface CorrectionResponse {
  transaction: {
    id: string;
    type: string;
    amount: string;
    balanceAfter: string;
    createdAt: string;
  };
  status: CorrectionStatus;
}

/** Cupo del actor (el propio empleado logueado). */
export function useCorrectionStatus(enabled = true) {
  return useQuery({
    queryKey: ['correction-status'],
    queryFn: () => apiGet<CorrectionStatus>('/tenant/correction/status'),
    enabled,
    staleTime: 15_000,
    retry: false,
  });
}

/** Aplica una corrección: Casa → cliente, dentro del cupo. */
export function useApplyCorrection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CorrectionPayload) =>
      apiPost<CorrectionResponse>('/tenant/correction', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['correction-status'] });
      qc.invalidateQueries({ queryKey: ['house-state'] });
      qc.invalidateQueries({ queryKey: ['audit-log'] });
      qc.invalidateQueries({ queryKey: ['wallet'] });
    },
  });
}

/** Admin fija el cupo mensual de un empleado. */
export function useSetCorrectionCap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { userId: string; cap: string }) =>
      apiPatch<{ userId: string; cap: string }>(
        `/tenant/correction/user/${payload.userId}/cap`,
        { cap: payload.cap },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['correction-status'] });
      qc.invalidateQueries({ queryKey: ['audit-log'] });
      qc.invalidateQueries({ queryKey: ['users'] });
    },
  });
}
