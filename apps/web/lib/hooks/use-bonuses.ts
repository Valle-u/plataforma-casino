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
import { apiGet, apiPatch, apiPost } from '../api-client';

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

export type BonusType =
  | 'welcome'
  | 'reload'
  | 'cashback'
  | 'manual'
  | 'free_spins'
  | 'no_deposit'
  | 'referral';

export type BonusDefinitionStatus =
  | 'draft'
  | 'active'
  | 'paused'
  | 'archived';

export interface BonusDefinition {
  id: string;
  code: string;
  name: string;
  type: BonusType;
  status: BonusDefinitionStatus;
  config: Record<string, unknown>;
  wagering: Record<string, unknown>;
  expirationDays: number;
  segmentFilter: Record<string, unknown>;
  visibility: Record<string, unknown>;
  fundedByUserId: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

interface BonusDefinitionsListResponse {
  data: BonusDefinition[];
  total: number;
}

export interface BonusDefinitionsFilters {
  status?: BonusDefinitionStatus;
  type?: BonusType;
  limit?: number;
  offset?: number;
}

function buildBonusDefQuery(filters: BonusDefinitionsFilters): string {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.type) params.set('type', filters.type);
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));
  const q = params.toString();
  return q ? `?${q}` : '';
}

export function useBonusDefinitions(filters: BonusDefinitionsFilters) {
  return useQuery({
    queryKey: ['bonus-definitions', filters],
    queryFn: () =>
      apiGet<BonusDefinitionsListResponse>(
        `/tenant/bonus-definitions${buildBonusDefQuery(filters)}`,
      ),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

export function useBonusDefinitionDetail(id: string | null) {
  return useQuery({
    queryKey: ['bonus-definition-detail', id],
    queryFn: () => apiGet<BonusDefinition>(`/tenant/bonus-definitions/${id}`),
    enabled: !!id,
    staleTime: 15_000,
  });
}

/** Atajo usado por el GrantBonusModal. */
export function useActiveBonusDefinitions() {
  return useBonusDefinitions({ status: 'active', limit: 200 });
}

// ──────────────────────────────────────────────────────────────────────
// Definitions mutations
// ──────────────────────────────────────────────────────────────────────

function invalidateBonusDefinitions(
  qc: ReturnType<typeof useQueryClient>,
  id?: string | null,
): void {
  qc.invalidateQueries({ queryKey: ['bonus-definitions'] });
  qc.invalidateQueries({ queryKey: ['audit-log'] });
  if (id) qc.invalidateQueries({ queryKey: ['bonus-definition-detail', id] });
}

export interface CreateBonusDefinitionPayload {
  code: string;
  name: string;
  type: BonusType;
  status?: BonusDefinitionStatus;
  config?: Record<string, unknown>;
  wagering?: Record<string, unknown>;
  expirationDays?: number;
  segmentFilter?: Record<string, unknown>;
  visibility?: Record<string, unknown>;
}

export function useCreateBonusDefinition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateBonusDefinitionPayload) =>
      apiPost<BonusDefinition>('/tenant/bonus-definitions', payload),
    onSuccess: (data) => invalidateBonusDefinitions(qc, data.id),
  });
}

export interface UpdateBonusDefinitionPayload {
  name?: string;
  status?: BonusDefinitionStatus;
  config?: Record<string, unknown>;
  wagering?: Record<string, unknown>;
  expirationDays?: number;
  segmentFilter?: Record<string, unknown>;
  visibility?: Record<string, unknown>;
}

export function useUpdateBonusDefinition(id: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateBonusDefinitionPayload) => {
      if (!id) throw new Error('bonus definition id requerido');
      return apiPatch<BonusDefinition>(
        `/tenant/bonus-definitions/${id}`,
        payload,
      );
    },
    onSuccess: () => invalidateBonusDefinitions(qc, id),
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
