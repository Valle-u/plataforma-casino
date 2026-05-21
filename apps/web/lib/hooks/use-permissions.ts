/**
 * Hooks de permission overrides para el panel admin.
 *
 * Endpoints:
 *   - GET    /tenant/permission-overrides/catalog        → catálogo completo.
 *   - GET    /tenant/permission-overrides/user/:userId   → overrides de un user.
 *   - GET    /tenant/permission-overrides/cascade-preview→ preview destructivo.
 *   - POST   /tenant/permission-overrides/grant          → grant override.
 *   - POST   /tenant/permission-overrides/revoke         → revoke override.
 *   - POST   /tenant/permission-overrides/clear          → clear override.
 *
 * Notas:
 *   - El detalle de un user (`useUserDetail` en `use-users.ts`) ya devuelve
 *     `effectivePermissions` (set calculado: roles + overrides + heredados).
 *     Acá solo agregamos lo específico de overrides explícitos.
 *   - `useCascadePreview` está deshabilitado por default (`enabled: false`)
 *     y se dispara on-demand desde el modal de revoke/clear.
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../api-client';

// ──────────────────────────────────────────────────────────────────────
// Catálogo
// ──────────────────────────────────────────────────────────────────────

export interface PermissionDef {
  code: string;
  category: string | null;
  description: string | null;
  isDelegatable: boolean;
  auditRequired: boolean;
}

interface CatalogResponse {
  data: PermissionDef[];
  count: number;
}

export function usePermissionsCatalog() {
  return useQuery({
    queryKey: ['permissions-catalog'],
    queryFn: () =>
      apiGet<CatalogResponse>('/tenant/permission-overrides/catalog'),
    staleTime: 5 * 60_000, // catálogo cambia muy poco
  });
}

/**
 * Sprint 51.5: lista los permission codes que el actor logueado puede
 * otorgar (su set efectivo ∩ delegables). Si es empleado-only, devuelve
 * `[]`. Usado por el `CreateUserModal` cuando se crea un empleado:
 * muestra solo los permisos válidos como checkbox list.
 */
export function useGrantableByMe() {
  return useQuery({
    queryKey: ['permissions-grantable-by-me'],
    queryFn: () =>
      apiGet<{ data: string[]; count: number }>(
        '/tenant/permission-overrides/grantable-by-me',
      ),
    staleTime: 60_000,
  });
}

// ──────────────────────────────────────────────────────────────────────
// Overrides de un user
// ──────────────────────────────────────────────────────────────────────

export type OverrideEffect = 'grant' | 'revoke';

export interface UserOverrideRow {
  permissionCode: string;
  effect: OverrideEffect;
  reason: string | null;
  grantedBy: string | null;
  grantedAt: string;
}

interface UserOverridesResponse {
  userId: string;
  overrides: UserOverrideRow[];
  count: number;
}

export function useUserOverrides(userId: string | null) {
  return useQuery({
    queryKey: ['permission-overrides', 'user', userId],
    queryFn: () =>
      apiGet<UserOverridesResponse>(
        `/tenant/permission-overrides/user/${userId}`,
      ),
    enabled: !!userId,
    staleTime: 15_000,
  });
}

// ──────────────────────────────────────────────────────────────────────
// Cascade preview — on-demand desde el modal de revoke/clear
// ──────────────────────────────────────────────────────────────────────

export interface CascadeAffectedRow {
  userId: string;
  effect: OverrideEffect;
  grantedBy: string | null;
  grantedAt: string;
}

export interface CascadePreviewResponse {
  userId: string;
  permissionCode: string;
  affected: CascadeAffectedRow[];
  count: number;
}

export function useCascadePreview(
  userId: string | null,
  permissionCode: string | null,
) {
  return useQuery({
    queryKey: ['cascade-preview', userId, permissionCode],
    queryFn: () => {
      const params = new URLSearchParams({
        userId: userId!,
        permissionCode: permissionCode!,
      });
      return apiGet<CascadePreviewResponse>(
        `/tenant/permission-overrides/cascade-preview?${params.toString()}`,
      );
    },
    enabled: !!userId && !!permissionCode,
    staleTime: 5_000,
  });
}

// ──────────────────────────────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────────────────────────────

function invalidateOverrides(
  qc: ReturnType<typeof useQueryClient>,
  userId: string,
): void {
  qc.invalidateQueries({ queryKey: ['permission-overrides', 'user', userId] });
  // El detalle del user trae effectivePermissions — invalidarlo también.
  qc.invalidateQueries({ queryKey: ['user-detail', userId] });
  // Audit log puede tener entradas nuevas (permissions.grant/revoke/clear).
  qc.invalidateQueries({ queryKey: ['audit-log'] });
  // Cascade preview puede haber cambiado.
  qc.invalidateQueries({ queryKey: ['cascade-preview'] });
}

export interface GrantOverridePayload {
  userId: string;
  permissionCode: string;
  reason?: string;
}

export interface GrantOverrideResponse {
  ok: true;
  effect: 'grant';
  chain: string[];
}

export function useGrantOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: GrantOverridePayload) =>
      apiPost<GrantOverrideResponse>(
        '/tenant/permission-overrides/grant',
        payload,
      ),
    onSuccess: (_data, vars) => invalidateOverrides(qc, vars.userId),
  });
}

export interface RevokeOverridePayload {
  userId: string;
  permissionCode: string;
  reason: string;
}

export interface RevokeOverrideResponse {
  ok: true;
  effect: 'revoke';
  cascadedCount: number;
  severity: 'normal' | 'high';
}

export function useRevokeOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: RevokeOverridePayload) =>
      apiPost<RevokeOverrideResponse>(
        '/tenant/permission-overrides/revoke',
        payload,
      ),
    onSuccess: (_data, vars) => invalidateOverrides(qc, vars.userId),
  });
}

export interface ClearOverridePayload {
  userId: string;
  permissionCode: string;
}

export interface ClearOverrideResponse {
  ok: true;
  cascadedCount: number;
}

export function useClearOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ClearOverridePayload) =>
      apiPost<ClearOverrideResponse>(
        '/tenant/permission-overrides/clear',
        payload,
      ),
    onSuccess: (_data, vars) => invalidateOverrides(qc, vars.userId),
  });
}
