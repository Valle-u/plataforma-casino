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
import { apiGet, apiPatch, apiPost } from '../api-client';

export interface TenantUserRow {
  id: string;
  username: string;
  email: string | null;
  displayName: string;
  status: string;
  createdAt: string;
}

export interface UsersListFilters {
  search?: string;
  status?: 'active' | 'banned' | 'suspended' | 'pending';
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
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));
  const q = params.toString();
  return q ? `?${q}` : '';
}

export function useUsersList(filters: UsersListFilters = {}) {
  return useQuery({
    queryKey: ['users-list', filters],
    queryFn: () =>
      apiGet<UsersListResponse>(`/tenant/users${buildUsersQuery(filters)}`),
    // Lista cacheable corto — server-side search hace los resultados muy
    // específicos por filters, así que el cache sigue siendo útil entre re-renders.
    staleTime: 30_000,
    placeholderData: (prev) => prev,
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
}

interface CreateUserResponse {
  user: TenantUserDetail['user'];
  createdBy: string;
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
