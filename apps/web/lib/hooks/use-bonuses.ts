/**
 * Hooks de bonos para el panel admin del operador.
 *
 * Endpoints:
 *   - GET    /tenant/bonuses?statuses=...&userId=...
 *   - GET    /tenant/bonuses/:id
 *   - GET    /tenant/bonus-definitions?status=active   (para el grant modal)
 *   - POST   /tenant/bonuses/grant                     (idempotency-key obligatorio)
 *   - POST   /tenant/bonuses/remove                    (débito manual de bono, idempotency-key obligatorio)
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch, apiPost } from '../api-client';
import {
  hasPermission,
  isAdminTenant,
  type TenantUser,
} from '../auth-context';
import { invalidateAllBalances } from '../query-balances';

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
// Player-facing: mis bonos (no requiere permiso bonuses.view_any)
// ──────────────────────────────────────────────────────────────────────

export interface MyBonusesFilters {
  statuses?: BonusStatus[];
  limit?: number;
  offset?: number;
}

interface MyBonusesResponse {
  data: BonusRow[];
  total: number;
}

function buildMyBonusesQuery(filters: MyBonusesFilters): string {
  const params = new URLSearchParams();
  if (filters.statuses && filters.statuses.length > 0) {
    params.set('statuses', filters.statuses.join(','));
  }
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));
  const q = params.toString();
  return q ? `?${q}` : '';
}

export function useMyBonuses(filters: MyBonusesFilters = {}) {
  return useQuery({
    queryKey: ['my-bonuses', filters],
    queryFn: () =>
      apiGet<MyBonusesResponse>(
        `/tenant/bonuses/me${buildMyBonusesQuery(filters)}`,
      ),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
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
  /**
   * Sprint 51.2/51.3: filtrar por id del creador (created_by_user_id).
   * Usado por el panel del socio independent para distinguir "mis
   * plantillas" vs "del tenant" (el frontend pasa el actor id o el
   * admin id en cada tab).
   */
  ownerUserIds?: string[];
  /**
   * Sprint 51.3: atajo semántico. 'mine' = ownerUserIds=[actor.id].
   * 'tenant' = ownerUserIds resuelto en backend a admin_tenant ids.
   */
  ownerScope?: 'mine' | 'tenant';
  limit?: number;
  offset?: number;
}

function buildBonusDefQuery(filters: BonusDefinitionsFilters): string {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.type) params.set('type', filters.type);
  if (filters.ownerUserIds && filters.ownerUserIds.length > 0) {
    params.set('ownerUserIds', filters.ownerUserIds.join(','));
  }
  if (filters.ownerScope) params.set('ownerScope', filters.ownerScope);
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
export function useActiveBonusDefinitions(
  filters: BonusDefinitionsFilters = {},
) {
  return useBonusDefinitions({ status: 'active', limit: 200, ...filters });
}

/**
 * Resuelve el scope de planillas que el actor puede VER/OTORGAR en el panel.
 * El backend (`autoScopeOwner`) ya auto-filtra a los socios independientes
 * y a su sub-red, pero para el admin_tenant devuelve TODAS (sin filtro) —
 * incluídas las de ramas independientes, que el admin NO puede otorgar
 * (LEYES R3/R4 → BonusOutOfBranchScopeError → 403). Para el admin y quienes
 * tengan el comodín `bonuses.grant_manual_admin_network`, el scope se
 * restringe a las del tenant. Para el resto devolvemos {} y el backend
 * auto-filtra (socio indep → 'mine'; sub-red indep → branch owner).
 */
export function bonusDefsScopeFor(
  actor: TenantUser | null,
): Pick<BonusDefinitionsFilters, 'ownerScope'> {
  if (
    isAdminTenant(actor) ||
    hasPermission(actor, 'bonuses.grant_manual_admin_network')
  ) {
    return { ownerScope: 'tenant' };
  }
  return {};
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bonuses'] });
      qc.invalidateQueries({ queryKey: ['bonuses-stats'] });
      // Grant debita el funder (o la Casa) y acredita bonus_balance del
      // jugador: refresca todos los balances en el momento.
      invalidateAllBalances(qc);
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
      // Cancel devuelve las fichas al funder/Casa: refresca balances.
      invalidateAllBalances(qc);
    },
  });
}

export interface RemoveBonusPayload {
  userId: string;
  amount: string;
  reason: string;
  notes?: string;
}

interface RemoveBonusResponse {
  userId: string;
  amount: string;
  funderUserId: string;
  anchorBonusId: string | null;
  debitTxId: string;
  revertTxId: string;
}

/**
 * Saca dinero de bono de un jugador. Espeja `RemoveBonusDto` del backend.
 * Debita `bonus_balance` y el reverso vuelve al funder original / Casa.
 * Idempotency-key auto-generada en el hook.
 */
export function useRemoveBonus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: RemoveBonusPayload) =>
      apiPost<RemoveBonusResponse>('/tenant/bonuses/remove', payload, {
        idempotencyKey: generateIdempotencyKey(),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bonuses'] });
      qc.invalidateQueries({ queryKey: ['bonuses-stats'] });
      // El débito baja el bonus_balance del jugador y acredita al
      // funder/Casa: refresca todos los balances en el momento.
      invalidateAllBalances(qc);
    },
  });
}
