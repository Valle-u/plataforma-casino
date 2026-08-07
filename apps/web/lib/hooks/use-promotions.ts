/**
 * Hooks de promotions/sorteos para el panel admin.
 *
 * Endpoints:
 *   - GET    /tenant/promotions               (admin con permission promotions.view)
 *   - GET    /tenant/promotions/:id
 *   - POST   /tenant/promotions               (permission promotions.create_definition)
 *   - PATCH  /tenant/promotions/:id           (permission promotions.edit_definition)
 *
 * NO incluimos los endpoints user-facing (spin/claim-streak/my-rewards) —
 * son de la app del jugador, no del panel admin.
 *
 * `config`/`prizes`/`targetSegment`/`visibility` son JSONB libres; los tratamos
 * como `Record<string, unknown>` y los renderizamos crudo en la UI por
 * simplicidad MVP. Editor especializado per type es sprint futuro.
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch, apiPost } from '../api-client';

export type PromotionType =
  | 'lottery_tickets'
  | 'lottery_ranking'
  | 'missions'
  | 'daily_wheel'
  | 'login_streak'
  | 'level_chests';

export type PromotionStatus =
  | 'draft'
  | 'scheduled'
  | 'active'
  | 'closed'
  | 'cancelled';

export interface PromotionRow {
  id: string;
  code: string;
  name: string;
  type: PromotionType;
  status: PromotionStatus;
  config: Record<string, unknown>;
  prizes: Record<string, unknown>;
  startsAt: string | null;
  endsAt: string | null;
  drawAt: string | null;
  targetSegment: Record<string, unknown>;
  visibility: Record<string, unknown>;
  scope: 'tenant';
  fundedByUserId: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface PromotionsFilters {
  type?: PromotionType;
  status?: PromotionStatus;
  limit?: number;
  offset?: number;
}

interface PromotionsListResponse {
  data: PromotionRow[];
  total: number;
}

function buildQuery(filters: PromotionsFilters): string {
  const params = new URLSearchParams();
  if (filters.type) params.set('type', filters.type);
  if (filters.status) params.set('status', filters.status);
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));
  const q = params.toString();
  return q ? `?${q}` : '';
}

export function usePromotions(filters: PromotionsFilters) {
  return useQuery({
    queryKey: ['promotions', filters],
    queryFn: () =>
      apiGet<PromotionsListResponse>(`/tenant/promotions${buildQuery(filters)}`),
    staleTime: 15_000,
  });
}

export function usePromotionDetail(id: string | null) {
  return useQuery({
    queryKey: ['promotion-detail', id],
    queryFn: () => apiGet<PromotionRow>(`/tenant/promotions/${id}`),
    enabled: !!id,
    staleTime: 15_000,
  });
}

// ──────────────────────────────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────────────────────────────

export interface CreatePromotionPayload {
  code: string;
  name: string;
  type: PromotionType;
  status?: PromotionStatus;
  config?: Record<string, unknown>;
  prizes?: Record<string, unknown>;
  startsAt?: string;
  endsAt?: string;
  drawAt?: string;
  targetSegment?: Record<string, unknown>;
  visibility?: Record<string, unknown>;
}

export function useCreatePromotion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreatePromotionPayload) =>
      apiPost<PromotionRow>('/tenant/promotions', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['promotions'] });
      qc.invalidateQueries({ queryKey: ['audit-log'] });
    },
  });
}

export interface UpdatePromotionPayload {
  name?: string;
  status?: PromotionStatus;
  config?: Record<string, unknown>;
  prizes?: Record<string, unknown>;
  startsAt?: string | null;
  endsAt?: string | null;
  drawAt?: string | null;
  targetSegment?: Record<string, unknown>;
  visibility?: Record<string, unknown>;
}

export function useUpdatePromotion(id: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdatePromotionPayload) => {
      if (!id) throw new Error('promotion id requerido');
      return apiPatch<PromotionRow>(`/tenant/promotions/${id}`, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['promotions'] });
      qc.invalidateQueries({ queryKey: ['audit-log'] });
      if (id) qc.invalidateQueries({ queryKey: ['promotion-detail', id] });
    },
  });
}

// ──────────────────────────────────────────────────────────────────────
// Rewards listing admin (Sprint 30)
// ──────────────────────────────────────────────────────────────────────

/**
 * Shape del prize jsonb que guarda el backend. Espeja `WheelPrize` /
 * `StreakPrize` del hook player — los kinds son los mismos. La diferencia
 * es que acá NO tipamos el `metadata` (puede traer rng, dayAnchor, segmentId,
 * etc. según el tipo de promo).
 */
export interface PromotionRewardPrize {
  kind: 'chips' | 'try_again' | 'bonus' | 'free_spins';
  amount?: number;
  bonusDefinitionId?: string;
  description?: string;
  label?: string;
}

export interface PromotionRewardRow {
  id: string;
  promotionId: string;
  userId: string;
  userUsername: string | null;
  userDisplayName: string | null;
  prize: PromotionRewardPrize;
  walletTxId: string | null;
  bonusId: string | null;
  idempotencyKey: string;
  metadata: Record<string, unknown> & {
    segmentId?: string;
    dayAnchor?: string;
    streak?: number;
    rng?: number;
  };
  grantedAt: string;
}

interface RewardsResponse {
  data: PromotionRewardRow[];
  total: number;
}

export interface PromotionRewardsFilters {
  userId?: string;
  limit?: number;
  offset?: number;
}

function buildRewardsQuery(filters: PromotionRewardsFilters): string {
  const params = new URLSearchParams();
  if (filters.userId) params.set('userId', filters.userId);
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));
  const q = params.toString();
  return q ? `?${q}` : '';
}

export function usePromotionRewards(
  promotionId: string | null,
  filters: PromotionRewardsFilters = {},
) {
  return useQuery({
    queryKey: ['promotion-rewards', promotionId, filters],
    queryFn: () => {
      if (!promotionId) throw new Error('promotionId requerido');
      return apiGet<RewardsResponse>(
        `/tenant/promotions/${promotionId}/rewards${buildRewardsQuery(filters)}`,
      );
    },
    enabled: !!promotionId,
    staleTime: 20_000,
  });
}
