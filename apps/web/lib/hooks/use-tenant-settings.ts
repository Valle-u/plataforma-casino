/**
 * Hooks de tenant_settings para el panel admin.
 *
 * Endpoints:
 *   - GET    /tenant/settings                  → lista todos los keys seteados.
 *   - GET    /tenant/settings/:key             → uno (404 si no seteado).
 *   - GET    /tenant/settings/:key/history     → historial de cambios.
 *   - PATCH  /tenant/settings/:key             → upsert { value }.
 *   - DELETE /tenant/settings/:key             → unset.
 *   - POST   /tenant/settings/history/purge    → corre retención manual.
 *
 * Todos requieren permission `tenant.settings.edit`.
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPatch, apiPost } from '../api-client';

export interface TenantSettingRow {
  key: string;
  value: unknown;
  updatedByUserId: string | null;
  updatedAt: string;
}

interface SettingsListResponse {
  data: TenantSettingRow[];
}

export function useTenantSettings() {
  return useQuery({
    queryKey: ['tenant-settings'],
    queryFn: () => apiGet<SettingsListResponse>('/tenant/settings'),
    staleTime: 30_000,
  });
}

export interface TenantSettingHistoryRow {
  id: string;
  key: string;
  value: unknown;
  changedByUserId: string | null;
  changedAt: string;
}

interface SettingHistoryResponse {
  data: TenantSettingHistoryRow[];
}

export function useTenantSettingHistory(key: string | null) {
  return useQuery({
    queryKey: ['tenant-setting-history', key],
    queryFn: () =>
      apiGet<SettingHistoryResponse>(`/tenant/settings/${key}/history?limit=50`),
    enabled: !!key,
    staleTime: 15_000,
  });
}

// ──────────────────────────────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────────────────────────────

function invalidate(qc: ReturnType<typeof useQueryClient>, key?: string): void {
  qc.invalidateQueries({ queryKey: ['tenant-settings'] });
  qc.invalidateQueries({ queryKey: ['audit-log'] });
  if (key) qc.invalidateQueries({ queryKey: ['tenant-setting-history', key] });
}

export interface SetSettingPayload {
  key: string;
  value: unknown;
}

export function useSetSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: SetSettingPayload) =>
      apiPatch<TenantSettingRow>(`/tenant/settings/${key}`, { value }),
    onSuccess: (_data, vars) => invalidate(qc, vars.key),
  });
}

export function useUnsetSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => apiDelete<void>(`/tenant/settings/${key}`),
    onSuccess: (_data, key) => invalidate(qc, key),
  });
}

export interface PurgeHistoryResponse {
  deleted: number;
  retentionDaysApplied: number;
}

export function usePurgeSettingsHistory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiPost<PurgeHistoryResponse>('/tenant/settings/history/purge', {}),
    onSuccess: () => invalidate(qc),
  });
}

/**
 * Catálogo client-side de keys conocidas con metadata para la UI
 * (label, descripción, tipo). Espeja `tenant-settings.registry.ts` del
 * backend — si agregás una key allá, agregala acá también para que la
 * UI la muestre prolija. Keys no listadas se renderizan como JSON crudo.
 */
export type SettingValueType =
  | 'boolean'
  | 'number'
  | 'integer'
  | 'json'
  | 'color' // HTML color picker (#RRGGBB)
  | 'url'; // input type=url + https-only validation

export interface KnownSettingMeta {
  key: string;
  category: string;
  label: string;
  description: string;
  valueType: SettingValueType;
  /** Para number/integer: min/max si los hay. Para booleano se ignora. */
  min?: number;
  max?: number;
  defaultValue?: unknown;
}

export const KNOWN_SETTINGS: KnownSettingMeta[] = [
  {
    key: 'fraud.suspected_threshold',
    category: 'Antifraude',
    label: 'Umbral "suspected"',
    description:
      'Score mínimo (0-100) para que un par de cuentas pase a status=suspected.',
    valueType: 'number',
    min: 0,
    max: 100,
    defaultValue: 70,
  },
  {
    key: 'fraud.welcome_block_threshold',
    category: 'Antifraude',
    label: 'Umbral "welcome block"',
    description:
      'Score mínimo (0-100) para bloquear welcome bonus + warning en grant manual.',
    valueType: 'number',
    min: 0,
    max: 100,
    defaultValue: 90,
  },
  {
    key: 'tenant_settings.history_retention_days',
    category: 'Sistema',
    label: 'Retención del history',
    description:
      'Días que se conserva el historial de tenant_settings (cron diario purga).',
    valueType: 'integer',
    min: 7,
    max: 3650,
    defaultValue: 365,
  },
  {
    key: 'notifications.email_enabled',
    category: 'Notificaciones',
    label: 'Email habilitado',
    description: 'Master switch del channel email. Si false, el dispatcher saltea.',
    valueType: 'boolean',
    defaultValue: true,
  },
  {
    key: 'notifications.in_app_enabled',
    category: 'Notificaciones',
    label: 'In-app habilitado',
    description: 'Master switch del channel in_app.',
    valueType: 'boolean',
    defaultValue: true,
  },
  {
    key: 'notifications.sms_enabled',
    category: 'Notificaciones',
    label: 'SMS habilitado',
    description: 'Master switch del channel SMS.',
    valueType: 'boolean',
    defaultValue: false,
  },
  {
    key: 'notifications.retention_days',
    category: 'Notificaciones',
    label: 'Retención de notifs',
    description:
      'Días que se conservan notifs enviadas/leídas (dispatcher purga).',
    valueType: 'integer',
    min: 7,
    max: 3650,
    defaultValue: 180,
  },
  {
    key: 'branding.primary_color',
    category: 'Branding',
    label: 'Color primario',
    description:
      'Hex #RRGGBB. Pisa --color-accent en el player. Si está vacío, usa el default rojo del DS.',
    valueType: 'color',
    defaultValue: '#dc2626',
  },
  {
    key: 'branding.logo_url',
    category: 'Branding',
    label: 'Logo (URL HTTPS)',
    description:
      'URL HTTPS del logo del tenant. Se renderiza en el header del player y como favicon. Subí la imagen a tu host (S3, CDN propio) y pegá la URL acá.',
    valueType: 'url',
  },
];

export const KNOWN_SETTINGS_BY_KEY = new Map(
  KNOWN_SETTINGS.map((m) => [m.key, m]),
);
