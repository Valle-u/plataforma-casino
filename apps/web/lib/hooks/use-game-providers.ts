/**
 * Hooks para la sección "Game Providers".
 *
 *   GET   /tenant/game-providers            → lista con estado + config.
 *   PATCH /tenant/game-providers/:code      → flags (habilitado / mantenimiento).
 *   POST  /tenant/game-providers/:code/test → probar conexión (ping).
 *   POST  /tenant/game-providers/:code/diagnose → diagnóstico pass/fail.
 *   POST  /tenant/game-providers/:code/sync → sync manual del catálogo.
 *
 * Las CREDENCIALES se cargan con `useSetSetting` (PATCH /tenant/settings/:key),
 * no con estos hooks.
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch, apiPost } from '@/lib/api-client';

export interface ProviderView {
  code: string;
  displayName: string;
  isEnabled: boolean;
  maintenanceMode: boolean;
  configured: boolean;
  config: {
    apiUrl: string | null;
    defaultLang: number | null;
    apiTokenSet: boolean;
  };
  lastSyncAt: string | null;
  lastSyncOk: boolean | null;
  lastSyncResult: unknown;
  lastPingAt: string | null;
  lastPingOk: boolean | null;
  lastPingLatencyMs: number | null;
}

export interface PingResult {
  ok: boolean;
  latencyMs: number | null;
  error: string | null;
}

export interface DiagnoseCheck {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface SyncResult {
  fetched: number;
  created: number;
  updated: number;
  deactivated: number;
}

export function useGameProviders() {
  return useQuery<ProviderView[]>({
    queryKey: ['game-providers'],
    queryFn: () => apiGet('/tenant/game-providers'),
    staleTime: 15_000,
  });
}

export function useUpdateProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      code,
      patch,
    }: {
      code: string;
      patch: { isEnabled?: boolean; maintenanceMode?: boolean };
    }) => apiPatch<ProviderView>(`/tenant/game-providers/${code}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['game-providers'] }),
  });
}

export function useTestProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) =>
      apiPost<PingResult>(`/tenant/game-providers/${code}/test`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['game-providers'] }),
  });
}

export function useDiagnoseProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) =>
      apiPost<DiagnoseCheck[]>(`/tenant/game-providers/${code}/diagnose`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['game-providers'] }),
  });
}

export function useSyncProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) =>
      apiPost<SyncResult>(`/tenant/game-providers/${code}/sync`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['game-providers'] }),
  });
}
