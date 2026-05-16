/**
 * Hooks de antifraude para el panel admin.
 *
 * Endpoints:
 *   - GET    /tenant/fraud/stats            → KPIs.
 *   - GET    /tenant/fraud/links?status=    → links paginados con username enriched.
 *   - GET    /tenant/fraud/clusters         → clusters via union-find.
 *   - GET    /tenant/fraud/links/:id        → detalle de un link.
 *   - POST   /tenant/fraud/links/:id/confirm
 *   - POST   /tenant/fraud/links/:id/dismiss
 *   - POST   /tenant/fraud/scans/run        → scan manual.
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../api-client';

export type FraudLinkStatus = 'suspected' | 'confirmed' | 'dismissed';

export interface FraudLinkSignal {
  type: string;
  weight: number;
  payload?: Record<string, unknown>;
}

export interface FraudLinkRow {
  id: string;
  userAId: string;
  userAUsername: string | null;
  userADisplayName: string | null;
  userBId: string;
  userBUsername: string | null;
  userBDisplayName: string | null;
  score: string;
  signals: FraudLinkSignal[];
  status: FraudLinkStatus;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  lastUpdatedAt: string;
}

interface FraudLinksResponse {
  data: FraudLinkRow[];
  total: number;
}

export interface FraudLinksFilters {
  status?: FraudLinkStatus;
  userId?: string;
  minScore?: number;
  limit?: number;
  offset?: number;
}

function buildQuery(filters: FraudLinksFilters): string {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.userId) params.set('userId', filters.userId);
  if (filters.minScore !== undefined) params.set('minScore', String(filters.minScore));
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));
  const q = params.toString();
  return q ? `?${q}` : '';
}

export function useFraudLinks(filters: FraudLinksFilters = {}) {
  return useQuery({
    queryKey: ['fraud-links', filters],
    queryFn: () =>
      apiGet<FraudLinksResponse>(`/tenant/fraud/links${buildQuery(filters)}`),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });
}

// ──────────────────────────────────────────────────────────────────────
// Stats
// ──────────────────────────────────────────────────────────────────────

export interface FraudStats {
  totalSignals: number;
  suspectedLinks: number;
  confirmedLinks: number;
  dismissedLinks: number;
}

export function useFraudStats() {
  return useQuery({
    queryKey: ['fraud-stats'],
    queryFn: () => apiGet<FraudStats>('/tenant/fraud/stats'),
    staleTime: 15_000,
  });
}

// ──────────────────────────────────────────────────────────────────────
// Clusters (union-find)
// ──────────────────────────────────────────────────────────────────────

export interface FraudClusterRow {
  userIds: string[];
  size: number;
  maxScore: number;
  status: 'suspected' | 'confirmed' | 'mixed';
}

interface FraudClustersResponse {
  data: FraudClusterRow[];
  total: number;
}

export function useFraudClusters() {
  return useQuery({
    queryKey: ['fraud-clusters'],
    queryFn: () => apiGet<FraudClustersResponse>('/tenant/fraud/clusters'),
    staleTime: 30_000,
  });
}

// ──────────────────────────────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────────────────────────────

function invalidateFraud(qc: ReturnType<typeof useQueryClient>): void {
  qc.invalidateQueries({ queryKey: ['fraud-links'] });
  qc.invalidateQueries({ queryKey: ['fraud-stats'] });
  qc.invalidateQueries({ queryKey: ['fraud-clusters'] });
}

export function useConfirmFraudLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (linkId: string) =>
      apiPost<FraudLinkRow>(`/tenant/fraud/links/${linkId}/confirm`),
    onSuccess: () => invalidateFraud(qc),
  });
}

export function useDismissFraudLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (linkId: string) =>
      apiPost<FraudLinkRow>(`/tenant/fraud/links/${linkId}/dismiss`),
    onSuccess: () => invalidateFraud(qc),
  });
}

export interface FraudScanResult {
  signalsCreated: number;
  pairsProcessed: number;
  newSuspectedLinks: number;
  preservedDismissedLinks: number;
}

export function useRunFraudScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<FraudScanResult>('/tenant/fraud/scans/run'),
    onSuccess: () => invalidateFraud(qc),
  });
}
