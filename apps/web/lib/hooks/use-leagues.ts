/**
 * Hooks de leagues para el panel admin.
 *
 * Endpoints:
 *   - GET    /tenant/leagues                        (cualquier user logueado)
 *   - GET    /tenant/leagues/:id
 *   - GET    /tenant/leagues/:id/standings?topN=N
 *   - GET    /tenant/leagues/:id/results
 *   - POST   /tenant/leagues                        (leagues.create_definition)
 *   - PATCH  /tenant/leagues/:id                    (leagues.edit_definition)
 *   - POST   /tenant/leagues/:id/recompute          (leagues.run_actions)
 *   - POST   /tenant/leagues/:id/close              (leagues.run_actions)
 *
 * Notas:
 *   - `metric_config`, `prizes`, `visibility` son JSONB libres; UI los
 *     trata como `Record<string, unknown>` y los renderiza crudo.
 *   - `recompute` no muta status; sí actualiza standings. Es idempotente.
 *   - `close` corre `closeAndSettle` (recompute + entrega premios → status closed).
 *     Idempotent: re-run sobre cerrada devuelve totals en 0.
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch, apiPost } from '../api-client';

export type LeaguePeriod =
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'season'
  | 'custom';

export type LeagueMetric =
  | 'bet_volume'
  | 'rounds_count'
  | 'gross_won'
  | 'player_netwin'
  | 'score_custom';

export type LeagueStatus = 'scheduled' | 'active' | 'closed';

export interface LeagueRow {
  id: string;
  code: string;
  name: string;
  period: LeaguePeriod;
  metric: LeagueMetric;
  metricConfig: Record<string, unknown>;
  prizes: Record<string, unknown>;
  startsAt: string;
  endsAt: string;
  status: LeagueStatus;
  visibility: Record<string, unknown>;
  fundedByUserId: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  /** Sprint 51.8.1: count vivo de participants — útil en la tabla principal. */
  participantsCount?: number;
}

export interface LeaguesFilters {
  status?: LeagueStatus;
  metric?: LeagueMetric;
  limit?: number;
  offset?: number;
}

interface LeaguesListResponse {
  data: LeagueRow[];
  total: number;
}

function buildQuery(filters: LeaguesFilters): string {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.metric) params.set('metric', filters.metric);
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));
  const q = params.toString();
  return q ? `?${q}` : '';
}

export function useLeagues(filters: LeaguesFilters) {
  return useQuery({
    queryKey: ['leagues', filters],
    queryFn: () =>
      apiGet<LeaguesListResponse>(`/tenant/leagues${buildQuery(filters)}`),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });
}

export function useLeagueDetail(id: string | null) {
  return useQuery({
    queryKey: ['league-detail', id],
    queryFn: () => apiGet<LeagueRow>(`/tenant/leagues/${id}`),
    enabled: !!id,
    staleTime: 15_000,
  });
}

// ──────────────────────────────────────────────────────────────────────
// Standings + Results
// ──────────────────────────────────────────────────────────────────────

export interface StandingRow {
  userId: string;
  score: string;
  position: number;
  /** Sprint 51.8.1: enriquecido por backend via JOIN. */
  username: string | null;
  displayName: string | null;
}

export interface StandingsView {
  top: StandingRow[];
  around?: StandingRow[];
  total: number;
}

export function useLeagueStandings(id: string | null, topN = 10) {
  return useQuery({
    queryKey: ['league-standings', id, topN],
    queryFn: () =>
      apiGet<StandingsView>(`/tenant/leagues/${id}/standings?topN=${topN}`),
    enabled: !!id,
    staleTime: 10_000,
  });
}

export interface LeagueResultRow {
  id: string;
  leagueId: string;
  userId: string;
  finalPosition: number;
  finalScore: string;
  prize: unknown;
  walletTxId: string | null;
  bonusId: string | null;
  idempotencyKey: string;
  settledAt: string;
}

interface LeagueResultsResponse {
  data: LeagueResultRow[];
}

export function useLeagueResults(id: string | null) {
  return useQuery({
    queryKey: ['league-results', id],
    queryFn: () => apiGet<LeagueResultsResponse>(`/tenant/leagues/${id}/results`),
    enabled: !!id,
    staleTime: 30_000,
  });
}

// ──────────────────────────────────────────────────────────────────────
// Sprint 51.8.1: settle preview (qué cobraría cada uno si cerrara ahora)
// ──────────────────────────────────────────────────────────────────────

export type LeaguePrize =
  | { kind: 'chips'; amount: number | string }
  | { kind: 'bonus'; definitionId: string; amount: number | string }
  | { kind: 'free_spins'; count: number; gameId?: string }
  | { kind: 'try_again' };

export interface SettlePreviewResponse {
  leagueId: string;
  leagueStatus: LeagueStatus;
  standings: Array<{
    position: number;
    userId: string;
    score: string;
    username: string | null;
    displayName: string | null;
    prize: LeaguePrize | null;
  }>;
  summary: {
    totalParticipants: number;
    withPrize: number;
    withoutPrize: number;
    totalChipsToAward: number;
  };
  prizesUnassigned: Array<{ position: number; prize: LeaguePrize }>;
}

export function useLeagueSettlePreview(
  id: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['league-settle-preview', id],
    queryFn: () =>
      apiGet<SettlePreviewResponse>(`/tenant/leagues/${id}/settle-preview`),
    enabled: !!id && enabled,
    staleTime: 5_000,
  });
}

// ──────────────────────────────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────────────────────────────

function invalidateLeague(
  qc: ReturnType<typeof useQueryClient>,
  id: string | null,
): void {
  qc.invalidateQueries({ queryKey: ['leagues'] });
  qc.invalidateQueries({ queryKey: ['audit-log'] });
  if (id) {
    qc.invalidateQueries({ queryKey: ['league-detail', id] });
    qc.invalidateQueries({ queryKey: ['league-standings', id] });
    qc.invalidateQueries({ queryKey: ['league-results', id] });
  }
}

export interface CreateLeaguePayload {
  code: string;
  name: string;
  period: LeaguePeriod;
  metric: LeagueMetric;
  metricConfig?: Record<string, unknown>;
  prizes?: Record<string, unknown>;
  startsAt: string;
  endsAt: string;
  visibility?: Record<string, unknown>;
}

export function useCreateLeague() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateLeaguePayload) =>
      apiPost<LeagueRow>('/tenant/leagues', payload),
    onSuccess: (data) => invalidateLeague(qc, data.id),
  });
}

export interface UpdateLeaguePayload {
  name?: string;
  status?: LeagueStatus;
  metricConfig?: Record<string, unknown>;
  prizes?: Record<string, unknown>;
  startsAt?: string;
  endsAt?: string;
  visibility?: Record<string, unknown>;
}

export function useUpdateLeague(id: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateLeaguePayload) => {
      if (!id) throw new Error('league id requerido');
      return apiPatch<LeagueRow>(`/tenant/leagues/${id}`, payload);
    },
    onSuccess: () => invalidateLeague(qc, id),
  });
}

export interface RecomputeResponse {
  participants: number;
}

export function useRecomputeLeague(id: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => {
      if (!id) throw new Error('league id requerido');
      return apiPost<RecomputeResponse>(`/tenant/leagues/${id}/recompute`, {});
    },
    onSuccess: () => invalidateLeague(qc, id),
  });
}

export interface CloseLeagueResponse {
  leagueId: string;
  leagueCode: string;
  totalParticipants: number;
  totalSettled: number;
  totalSkipped: number;
  totalFailed: number;
  failedUserIds: string[];
}

export function useCloseLeague(id: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => {
      if (!id) throw new Error('league id requerido');
      return apiPost<CloseLeagueResponse>(`/tenant/leagues/${id}/close`, {});
    },
    onSuccess: () => invalidateLeague(qc, id),
  });
}
