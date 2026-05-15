/**
 * Hooks de bonos para el panel admin del operador.
 *
 * Endpoints:
 *   - GET    /tenant/bonuses?statuses=...&userId=...
 *   - GET    /tenant/bonuses/:id
 *   - GET    /tenant/bonus-definitions?status=active   (para el grant modal)
 *   - POST   /tenant/bonuses/grant                     (idempotency-key obligatorio)
 *   - POST   /tenant/bonuses/:id/cancel  { reason }
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../api-client';

export type BonusStatus =
  | 'active'
  | 'pending'
  | 'cleared'
  | 'cancelled'
  | 'expired'
  | 'force_cleared';

export interface BonusRow {
  id: string;
  userId: string;
  userUsername: string | null;
  userDisplayName: string | null;
  definitionId: string;
  definitionCode: string | null;
  definitionName: string | null;
  definitionType: string | null;
  grantedAmount: string;
  remainingAmount: string;
  status: BonusStatus;
  fundedByUserId: string;
  grantedByUserId: string | null;
  reason: string | null;
  grantedAt: string;
  activatedAt: string | null;
  expiresAt: string | null;
  clearedAt: string | null;
  cancelledAt: string | null;
}

interface BonusesListResponse {
  data: BonusRow[];
  total: number;
}

export interface BonusesFilters {
  statuses?: BonusStatus[];
  userId?: string;
  definitionId?: string;
  limit?: number;
  offset?: number;
}

function buildQuery(filters: BonusesFilters): string {
  const params = new URLSearchParams();
  if (filters.statuses && filters.statuses.length > 0) {
    params.set('statuses', filters.statuses.join(','));
  }
  if (filters.userId) params.set('userId', filters.userId);
  if (filters.definitionId) params.set('definitionId', filters.definitionId);
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));
  const q = params.toString();
  return q ? `?${q}` : '';
}

export function useBonuses(filters: BonusesFilters) {
  return useQuery({
    queryKey: ['bonuses', filters],
    queryFn: () => apiGet<BonusesListResponse>(`/tenant/bonuses${buildQuery(filters)}`),
    staleTime: 15_000,
  });
}

export function useBonusDetail(id: string | null) {
  return useQuery({
    queryKey: ['bonus-detail', id],
    queryFn: () => apiGet<BonusRow>(`/tenant/bonuses/${id}`),
    enabled: !!id,
    staleTime: 15_000,
  });
}

// ──────────────────────────────────────────────────────────────────────
// Definitions (para el dropdown del grant modal)
// ──────────────────────────────────────────────────────────────────────

export interface BonusDefinition {
  id: string;
  code: string;
  name: string;
  type: string;
  status: 'active' | 'archived' | 'draft';
  config: Record<string, unknown>;
  fundedByUserId: string;
  expirationDays: number;
  createdAt: string;
  updatedAt: string;
}

export function useActiveBonusDefinitions() {
  return useQuery({
    queryKey: ['bonus-definitions', 'active'],
    queryFn: () =>
      apiGet<BonusDefinition[]>('/tenant/bonus-definitions?status=active'),
    staleTime: 60_000,
  });
}

// ──────────────────────────────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────────────────────────────

function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Array.from({ length: 32 })
    .map(() => Math.floor(Math.random() * 16).toString(16))
    .join('');
}

export interface GrantBonusPayload {
  userId: string;
  definitionId: string;
  amount: string;
  reason: string;
  notes?: string;
}

interface GrantBonusResponse extends BonusRow {
  fraudWarning?: boolean;
}

export function useGrantBonus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: GrantBonusPayload) =>
      apiPost<GrantBonusResponse>('/tenant/bonuses/grant', payload, {
        idempotencyKey: generateIdempotencyKey(),
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['bonuses'] });
      qc.invalidateQueries({ queryKey: ['bonuses-stats'] });
      qc.invalidateQueries({ queryKey: ['my-wallet'] });
      qc.invalidateQueries({ queryKey: ['my-transactions'] });
      qc.invalidateQueries({ queryKey: ['user-wallet', data.userId] });
      qc.invalidateQueries({ queryKey: ['user-transactions', data.userId] });
    },
  });
}

export function useCancelBonus(id: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { reason: string; notes?: string }) => {
      if (!id) throw new Error('bonusId requerido');
      return apiPost<BonusRow>(`/tenant/bonuses/${id}/cancel`, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bonuses'] });
      qc.invalidateQueries({ queryKey: ['bonuses-stats'] });
      if (id) qc.invalidateQueries({ queryKey: ['bonus-detail', id] });
    },
  });
}
