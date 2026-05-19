/**
 * Hooks de commissions (revenue share a jerarquía upstream).
 *
 * Endpoints (Sprint 24 — solo CRUD + compute preview, apply en Sprint 25):
 *   - GET    /tenant/commissions/rules?eventType=&activeOnly=...
 *   - GET    /tenant/commissions/rules/:id
 *   - POST   /tenant/commissions/rules                (commissions.configure)
 *   - PATCH  /tenant/commissions/rules/:id            (idem)
 *   - POST   /tenant/commissions/rules/:id/archive    (idem)
 *   - GET    /tenant/commissions/payouts?...          (commissions.view + scope)
 *   - POST   /tenant/commissions/preview              (commissions.configure)
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch, apiPost } from '../api-client';

export type CommissionEventType = 'deposit_approved' | 'withdrawal_paid';

export type CommissionPayoutStatus =
  | 'pending'
  | 'paid'
  | 'failed'
  | 'refunded';

export interface CommissionRule {
  id: string;
  role: string;
  eventType: CommissionEventType;
  pct: string; // "5.00"
  active: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RulesListResponse {
  data: CommissionRule[];
}

export interface RulesFilters {
  eventType?: CommissionEventType;
  activeOnly?: boolean;
}

function buildRulesQuery(filters: RulesFilters): string {
  const params = new URLSearchParams();
  if (filters.eventType) params.set('eventType', filters.eventType);
  if (filters.activeOnly) params.set('activeOnly', 'true');
  const q = params.toString();
  return q ? `?${q}` : '';
}

export function useCommissionRules(filters: RulesFilters = {}) {
  return useQuery({
    queryKey: ['commission-rules', filters],
    queryFn: () =>
      apiGet<RulesListResponse>(
        `/tenant/commissions/rules${buildRulesQuery(filters)}`,
      ),
    staleTime: 30_000,
  });
}

export function useCommissionRuleDetail(id: string | null) {
  return useQuery({
    queryKey: ['commission-rule-detail', id],
    queryFn: () => apiGet<CommissionRule>(`/tenant/commissions/rules/${id}`),
    enabled: !!id,
    staleTime: 15_000,
  });
}

// ──────────────────────────────────────────────────────────────────────
// Mutations (commissions.configure)
// ──────────────────────────────────────────────────────────────────────

function invalidateRules(
  qc: ReturnType<typeof useQueryClient>,
  id?: string | null,
): void {
  qc.invalidateQueries({ queryKey: ['commission-rules'] });
  qc.invalidateQueries({ queryKey: ['audit-log'] });
  if (id) qc.invalidateQueries({ queryKey: ['commission-rule-detail', id] });
}

export interface CreateCommissionRulePayload {
  role: string;
  eventType: CommissionEventType;
  pct: string;
  active?: boolean;
  notes?: string | null;
}

export function useCreateCommissionRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateCommissionRulePayload) =>
      apiPost<CommissionRule>('/tenant/commissions/rules', payload),
    onSuccess: () => invalidateRules(qc),
  });
}

export interface UpdateCommissionRulePayload {
  pct?: string;
  active?: boolean;
  notes?: string | null;
}

export function useUpdateCommissionRule(id: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateCommissionRulePayload) => {
      if (!id) throw new Error('rule id requerido');
      return apiPatch<CommissionRule>(
        `/tenant/commissions/rules/${id}`,
        payload,
      );
    },
    onSuccess: () => invalidateRules(qc, id),
  });
}

export function useArchiveCommissionRule(id: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => {
      if (!id) throw new Error('rule id requerido');
      return apiPost<CommissionRule>(
        `/tenant/commissions/rules/${id}/archive`,
        {},
      );
    },
    onSuccess: () => invalidateRules(qc, id),
  });
}

// ──────────────────────────────────────────────────────────────────────
// Payouts (read-only — apply en Sprint 25)
// ──────────────────────────────────────────────────────────────────────

export interface CommissionPayout {
  id: string;
  beneficiaryUserId: string;
  beneficiaryUsername: string | null;
  beneficiaryDisplayName: string | null;
  beneficiaryRoleAtTime: string;
  ruleId: string | null;
  pct: string;
  sourceEventType: string;
  sourceEventId: string;
  sourceAmount: string;
  payoutAmount: string;
  status: CommissionPayoutStatus;
  walletTxId: string | null;
  error: string | null;
  createdAt: string;
  paidAt: string | null;
}

interface PayoutsListResponse {
  data: CommissionPayout[];
  total: number;
}

export interface PayoutsFilters {
  beneficiaryUserId?: string;
  sourceEventType?: string;
  sourceEventId?: string;
  status?: CommissionPayoutStatus;
  limit?: number;
  offset?: number;
}

function buildPayoutsQuery(filters: PayoutsFilters): string {
  const params = new URLSearchParams();
  if (filters.beneficiaryUserId)
    params.set('beneficiaryUserId', filters.beneficiaryUserId);
  if (filters.sourceEventType)
    params.set('sourceEventType', filters.sourceEventType);
  if (filters.sourceEventId) params.set('sourceEventId', filters.sourceEventId);
  if (filters.status) params.set('status', filters.status);
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));
  const q = params.toString();
  return q ? `?${q}` : '';
}

export function useCommissionPayouts(filters: PayoutsFilters = {}) {
  return useQuery({
    queryKey: ['commission-payouts', filters],
    queryFn: () =>
      apiGet<PayoutsListResponse>(
        `/tenant/commissions/payouts${buildPayoutsQuery(filters)}`,
      ),
    staleTime: 20_000,
  });
}

// ──────────────────────────────────────────────────────────────────────
// Preview compute (in-memory, no persiste)
// ──────────────────────────────────────────────────────────────────────

export interface CommissionPreviewItem {
  beneficiaryUserId: string;
  beneficiaryUsername: string | null;
  beneficiaryRoleAtTime: string;
  ruleId: string;
  pct: string;
  payoutAmount: string;
}

export interface CommissionPreviewResponse {
  plan: CommissionPreviewItem[];
  summary: {
    beneficiaries: number;
    sourceAmount: string;
    totalPayout: string;
    tenantKeeps: string;
  };
}

export interface CommissionPreviewPayload {
  eventType: CommissionEventType;
  sourceUserId: string;
  sourceAmount: string;
}

export function usePreviewCommission() {
  return useMutation({
    mutationFn: (payload: CommissionPreviewPayload) =>
      apiPost<CommissionPreviewResponse>(
        '/tenant/commissions/preview',
        payload,
      ),
  });
}

// ──────────────────────────────────────────────────────────────────────
// Stats (Sprint 32) — widget /admin/dashboard
// ──────────────────────────────────────────────────────────────────────

export interface CommissionsStatsBucket {
  today: string;
  last7d: string;
  last30d: string;
}

export interface CommissionsStats {
  earnedByMe: CommissionsStatsBucket;
  earnedByTeam: CommissionsStatsBucket;
  countByMe7d: number;
  countByTeam7d: number;
  /** NULL si el actor NO tiene commissions.view_all. */
  tenantTotal: CommissionsStatsBucket | null;
}

export function useCommissionsStats() {
  return useQuery({
    queryKey: ['commissions-stats'],
    queryFn: () => apiGet<CommissionsStats>('/tenant/commissions/stats'),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}
