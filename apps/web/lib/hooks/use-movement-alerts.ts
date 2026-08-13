/**
 * Hooks de "Movimientos sospechosos" (fraude interno sobre el ledger).
 * Endpoints: /tenant/movement-alerts (view/review/run).
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../api-client';

export type MovAlertStatus = 'suspected' | 'confirmed' | 'dismissed';
export type MovAlertSeverity = 'low' | 'medium' | 'high';

export interface MovementAlertRow {
  id: string;
  rule: string;
  actorUserId: string | null;
  actorUsername: string | null;
  actorDisplayName: string | null;
  subjectUserId: string | null;
  subjectUsername: string | null;
  subjectDisplayName: string | null;
  amount: string | null;
  severity: MovAlertSeverity;
  details: Record<string, unknown>;
  period: string;
  status: MovAlertStatus;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  detectedAt: string;
  lastUpdatedAt: string;
}

export interface MovementAlertStats {
  suspected: number;
  confirmed: number;
  dismissed: number;
}

export interface MovementScanResult {
  alertsCreated: number;
  newSuspected: number;
  preservedDismissed: number;
}

export function useMovementAlerts(filters: {
  status?: MovAlertStatus;
  limit?: number;
  offset?: number;
}) {
  const { status, limit = 25, offset = 0 } = filters;
  return useQuery<{ data: MovementAlertRow[]; total: number }>({
    queryKey: ['movement-alerts', { status, limit, offset }],
    queryFn: () => {
      const p = new URLSearchParams();
      if (status) p.set('status', status);
      p.set('limit', String(limit));
      p.set('offset', String(offset));
      return apiGet<{ data: MovementAlertRow[]; total: number }>(
        `/tenant/movement-alerts?${p.toString()}`,
      );
    },
    staleTime: 15_000,
  });
}

export function useMovementAlertStats() {
  return useQuery<MovementAlertStats>({
    queryKey: ['movement-alert-stats'],
    queryFn: () => apiGet<MovementAlertStats>('/tenant/movement-alerts/stats'),
    staleTime: 15_000,
  });
}

export function useConfirmMovementAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiPost(`/tenant/movement-alerts/${id}/confirm`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['movement-alerts'] });
      qc.invalidateQueries({ queryKey: ['movement-alert-stats'] });
      qc.invalidateQueries({ queryKey: ['audit-log'] });
    },
  });
}

export function useDismissMovementAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiPost(`/tenant/movement-alerts/${id}/dismiss`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['movement-alerts'] });
      qc.invalidateQueries({ queryKey: ['movement-alert-stats'] });
      qc.invalidateQueries({ queryKey: ['audit-log'] });
    },
  });
}

export function useRunMovementScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiPost<MovementScanResult>('/tenant/movement-alerts/scan/run', {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['movement-alerts'] });
      qc.invalidateQueries({ queryKey: ['movement-alert-stats'] });
    },
  });
}
