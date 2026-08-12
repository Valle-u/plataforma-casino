/**
 * Hooks de users del tenant.
 *
 * `useUsersList(filters?)` — `GET /tenant/users` con filtros server-side:
 *   - search: ILIKE sobre username/displayName/email (case-insensitive).
 *   - status: enum activo/banned/suspended/pending.
 *   - limit/offset: paginación (default 50, max 200).
 *
 * El backend retorna `data` (página actual) + `count` (filas en data) +
 * `total` (matchs totales cross-page, para pagers).
 *
 * Llamar `useUsersList()` sin argumentos mantiene el comportamiento legacy:
 * trae los primeros 50 sin filtros. Para escalar a >500 users, pasar
 * search/limit explícito desde el caller.
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch, apiPost, apiPut, apiDelete } from '../api-client';

export interface TenantUserRow {
  id: string;
  username: string;
  email: string | null;
  displayName: string;
  status: string;
  createdAt: string;
  /** Sprint 51.10: campos enriquecidos. */
  lastLoginAt: string | null;
  isIndependentBranch: boolean;
  underIndependentBranch: boolean;
  roleCodes: string[];
  parentUserId: string | null;
  parentUsername: string | null;
  walletBalance: string | null;
  bonusBalance: string | null;
}

export interface UsersListFilters {
  search?: string;
  status?: 'active' | 'banned' | 'suspended' | 'pending';
  /** Sprint 51.10: filtra a users que tengan este rol code asignado. */
  role?: string;
  /** Si true, NO excluye al actor del listado (para el selector de padre:
   *  el admin debe poder colgar un jugador de sí mismo / la casa). */
  includeSelf?: boolean;
  limit?: number;
  offset?: number;
}

interface UsersListResponse {
  data: TenantUserRow[];
  count: number;
  total: number;
  requestedBy: string;
}

function buildUsersQuery(filters: UsersListFilters): string {
  const params = new URLSearchParams();
  if (filters.search && filters.search.trim() !== '') {
    params.set('search', filters.search.trim());
  }
  if (filters.status) params.set('status', filters.status);
  if (filters.role && filters.role.trim() !== '')
    params.set('role', filters.role.trim());
  if (filters.includeSelf) params.set('includeSelf', 'true');
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));
  const q = params.toString();
  return q ? `?${q}` : '';
}

export function useUsersList(
  filters: UsersListFilters = {},
  options?: { refetchInterval?: number | false },
) {
  return useQuery({
    queryKey: ['users-list', filters],
    queryFn: () =>
      apiGet<UsersListResponse>(`/tenant/users${buildUsersQuery(filters)}`),
    // Lista cacheable corto — server-side search hace los resultados muy
    // específicos por filters, así que el cache sigue siendo útil entre re-renders.
    staleTime: 30_000,
    // Sprint 55: la lista pinta walletBalance/bonusBalance por fila. El
    // balance puede cambiar por fuentes que esta sesión no conoce (carga/
    // retiro desde otro tab, depósito self-service del player, sesión de
    // juego, jobs). La invalidación por mutación cubre lo que ocurre en
    // ESTE tab; el polling cubre el resto para que el operador no tenga
    // que refrescar manualmente. Opt-in: solo el page /users lo activa
    // (el UserSelect de autocomplete no debe pollear).
    refetchInterval: options?.refetchInterval,
    refetchIntervalInBackground: !!options?.refetchInterval,
    refetchOnWindowFocus: !!options?.refetchInterval,
    refetchOnReconnect: !!options?.refetchInterval,
  });
}

export interface TenantUserDetail {
  user: {
    id: string;
    username: string;
    email: string | null;
    displayName: string;
    phone: string | null;
    status: string;
    createdAt: string;
    updatedAt: string;
    twoFaEnabled?: boolean;
    /** Sprint 51 — modo sucursal independiente (solo socios). */
    isIndependentBranch?: boolean;
    underIndependentBranch?: boolean;
    branchBankAccount?: string | null;
    branchChipsPricePerUnit?: string | null;
  };
  roles: Array<{ code: string; name: string; isSystem: boolean }>;
  effectivePermissions: string[];
}

export function useUserDetail(userId: string | null) {
  return useQuery({
    queryKey: ['user-detail', userId],
    queryFn: () => apiGet<TenantUserDetail>(`/tenant/users/${userId}`),
    enabled: !!userId,
    staleTime: 30_000,
  });
}

// ──────────────────────────────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────────────────────────────

export interface CreateUserPayload {
  username: string;
  password: string;
  displayName: string;
  email?: string;
  phone?: string;
  roleCode: string;
  /** Sprint 51.5: permisos opcionales a otorgar como overrides al crear. */
  permissionOverrides?: string[];
}

interface CreateUserResponse {
  user: TenantUserDetail['user'];
  createdBy: string;
  permissionOverrides?: string[];
  /**
   * F1.1a — perms económicos bloqueados por default por la política de
   * "rama dependiente" (cajero/distribuidor creado bajo socio dep). El
   * front lo muestra en la toast informativa.
   */
  permissionDenied?: string[];
  parentAssigned?: boolean;
}

/**
 * `POST /tenant/users` — crea user nuevo + asigna rol.
 *
 * On success: invalida `users-list` (tabla se refresca con el nuevo user)
 * y `users-list-dashboard` (KPI count). NO invalidamos `user-detail` —
 * el detalle del nuevo user no estaba cacheado.
 */
export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateUserPayload) =>
      apiPost<CreateUserResponse>('/tenant/users', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users-list'] });
      qc.invalidateQueries({ queryKey: ['users-list-dashboard'] });
    },
  });
}

export interface UpdateUserPayload {
  status?: 'active' | 'pending' | 'suspended' | 'banned';
  displayName?: string;
  email?: string | null;
  phone?: string | null;
}

interface UpdateUserResponse {
  user: TenantUserDetail['user'];
  updatedBy: string;
}

/**
 * `PATCH /tenant/users/:id` — update parcial.
 * Invalida lista + detalle del user editado.
 */
export function useUpdateUser(userId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateUserPayload) => {
      if (!userId) throw new Error('userId requerido para update.');
      return apiPatch<UpdateUserResponse>(`/tenant/users/${userId}`, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users-list'] });
      qc.invalidateQueries({ queryKey: ['users-list-dashboard'] });
      if (userId) qc.invalidateQueries({ queryKey: ['user-detail', userId] });
    },
  });
}

/**
 * Sprint 51.4: `POST /tenant/users/:id/reset-password` — admin/socio
 * resetea password a un user downstream.
 *
 * Body: `{ newPassword, twoFaCode?, reason? }`. El backend valida:
 *   - ScopeGuard: target debe estar en downstream del actor.
 *   - Permiso `users.reset_password`.
 *   - 2FA si el rol del actor lo requiere y la tiene habilitada.
 *
 * NO invalida sesiones activas del target (el dueño puede pedirlo en
 * un sprint futuro — requiere bumpear el JWT issued-at threshold).
 */
export interface ResetPasswordPayload {
  newPassword: string;
  twoFaCode?: string;
  reason?: string;
}

interface ResetPasswordResponse {
  user: TenantUserDetail['user'];
  by: string;
  sessionsInvalidated: false;
}

export function useResetUserPassword(userId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ResetPasswordPayload) => {
      if (!userId) throw new Error('userId requerido para reset-password.');
      return apiPost<ResetPasswordResponse>(
        `/tenant/users/${userId}/reset-password`,
        payload,
      );
    },
    onSuccess: () => {
      // No hay nada visible que invalidar (la password no se muestra),
      // pero invalidamos detail por consistencia + audit log si está cacheado.
      if (userId) qc.invalidateQueries({ queryKey: ['user-detail', userId] });
      qc.invalidateQueries({ queryKey: ['audit-log'] });
    },
  });
}

// ──────────────────────────────────────────────────────────────────────
// Sprint 51.10: stats agregados para el header del panel /users.
// ──────────────────────────────────────────────────────────────────────

export interface UsersStatsResponse {
  total: number;
  byStatus: Record<string, number>;
  byRole: Array<{ code: string; name: string; count: number }>;
  activeLast24h: number;
  activeLast7d: number;
  createdLast7d: number;
}

export function useUsersStats() {
  return useQuery({
    queryKey: ['users-stats'],
    queryFn: () => apiGet<UsersStatsResponse>('/tenant/users/stats'),
    staleTime: 60_000, // los counts no se mueven mucho, 1 min está OK.
    placeholderData: (prev) => prev,
  });
}

// ──────────────────────────────────────────────────────────────────────
// Sprint: user hierarchy (parent management)
// ──────────────────────────────────────────────────────────────────────

export interface UserParentInfo {
  id: string;
  userId: string;
  parentUserId: string;
  relationType: string;
  since: string;
  createdBy: string;
}

export function useUserParent(userId: string | null) {
  return useQuery({
    queryKey: ['user-parent', userId],
    queryFn: () =>
      apiGet<{ parent: UserParentInfo | null }>(
        `/tenant/user-hierarchy/${userId}/parent`,
      ),
    enabled: !!userId,
    staleTime: 30_000,
  });
}

export interface SetParentPayload {
  parentUserId: string;
  relationType: string;
}

export function useSetParent(userId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: SetParentPayload) => {
      if (!userId) throw new Error('userId requerido para setParent.');
      return apiPut<{ ok: true; relation: UserParentInfo }>(
        `/tenant/user-hierarchy/${userId}/parent`,
        payload,
      );
    },
    onSuccess: () => {
      if (userId) {
        qc.invalidateQueries({ queryKey: ['user-parent', userId] });
        qc.invalidateQueries({ queryKey: ['network-tree'] });
        qc.invalidateQueries({ queryKey: ['users-list'] });
      }
    },
  });
}

export function useClearParent(userId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => {
      if (!userId) throw new Error('userId requerido para clearParent.');
      return apiDelete<{ ok: true; cleared: boolean }>(
        `/tenant/user-hierarchy/${userId}/parent`,
      );
    },
    onSuccess: () => {
      if (userId) {
        qc.invalidateQueries({ queryKey: ['user-parent', userId] });
        qc.invalidateQueries({ queryKey: ['network-tree'] });
        qc.invalidateQueries({ queryKey: ['users-list'] });
      }
    },
  });
}
