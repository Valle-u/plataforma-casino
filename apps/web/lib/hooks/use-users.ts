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

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../api-client';

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
