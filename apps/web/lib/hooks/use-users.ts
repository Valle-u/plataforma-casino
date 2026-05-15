/**
 * Hooks de users del tenant.
 *
 * `useUsersList` — `GET /tenant/users` (devuelve todos los users).
 * `useUserDetail(id)` — `GET /tenant/users/:id` (con roles + permisos).
 *
 * El backend hoy NO paginá ni filtra server-side — el filtro lo hace el
 * frontend (search + status/role) sobre el array completo. Cuando el
 * tenant pase de ~500 users, sumar paginación server.
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

interface UsersListResponse {
  data: TenantUserRow[];
  count: number;
  requestedBy: string;
}

export function useUsersList() {
  return useQuery({
    queryKey: ['users-list'],
    queryFn: () => apiGet<UsersListResponse>('/tenant/users'),
    // Lista de users no cambia tan frecuentemente — staleTime más largo.
    staleTime: 60_000,
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
