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
    placeholderData: (prev) => prev,
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
  | 'url' // input type=url + https-only validation
  | 'text'; // texto libre corto (string single-line)

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
    label: 'Marca como "sospechosa"',
    description:
      'Cuánta similitud deben tener dos cuentas (misma IP, mismo teléfono, mismo dispositivo…) para marcarlas como sospechosas. De 0 (suelto) a 100 (estricto). Ej: 70 = se marca cuando el puntaje llega a 70.',
    valueType: 'number',
    min: 0,
    max: 100,
    defaultValue: 70,
  },
  {
    key: 'fraud.welcome_block_threshold',
    category: 'Antifraude',
    label: 'Bloquea el bono de bienvenida',
    description:
      'Cuando el puntaje de similitud supera este valor, la cuenta sospechosa no recibe el bono de bienvenida. De 0 (bloquea fácil) a 100 (bloquea solo en casos extremos). Ej: 90 = muy estricto.',
    valueType: 'number',
    min: 0,
    max: 100,
    defaultValue: 90,
  },
  {
    key: 'tenant_settings.history_retention_days',
    category: 'Sistema',
    label: 'Retención del registro',
    description:
      'Cuántos días se guarda el registro de cambios de esta pantalla (qué se cambió, quién y cuándo). Ej: 365 = se borran los cambios de hace más de un año.',
    valueType: 'integer',
    min: 7,
    max: 3650,
    defaultValue: 365,
  },
  {
    key: 'notifications.email_enabled',
    category: 'Notificaciones',
    label: 'Email',
    description:
      'Avisos por email (ej: depósito acreditado, retiro aprobado).',
    valueType: 'boolean',
    defaultValue: true,
  },
  {
    key: 'notifications.in_app_enabled',
    category: 'Notificaciones',
    label: 'Dentro del casino',
    description:
      'Avisos en la campana dentro del casino (in-app).',
    valueType: 'boolean',
    defaultValue: true,
  },
  {
    key: 'notifications.push_enabled',
    category: 'Notificaciones',
    label: 'Navegador (push)',
    description:
      'Avisos que saltan en el navegador del jugador. El jugador tiene que aceptar el permiso la primera vez.',
    valueType: 'boolean',
    defaultValue: true,
  },
  {
    key: 'notifications.sms_enabled',
    category: 'Notificaciones',
    label: 'SMS',
    description:
      'Mensajes de texto al celular del jugador.',
    valueType: 'boolean',
    defaultValue: false,
  },
  {
    key: 'notifications.retention_days',
    category: 'Notificaciones',
    label: 'Retención de avisos',
    description:
      'Cuántos días se guardan los avisos viejos antes de limpiarlos. Ej: 180 = se borran a los 6 meses.',
    valueType: 'integer',
    min: 7,
    max: 3650,
    defaultValue: 180,
  },
  {
    key: 'branding.platform_name',
    category: 'Marca',
    label: 'Nombre del casino',
    description:
      'El nombre que ven los jugadores: menú lateral, pestaña del navegador y wordmark.',
    valueType: 'text',
    defaultValue: 'Casino TANGO',
  },
  {
    key: 'branding.tagline',
    category: 'Marca',
    label: 'Frase bajo el nombre',
    description:
      'Una frase corta que acompaña al nombre. Ej: "El Casino del Pueblo". Aparece en el login y en la portada del jugador.',
    valueType: 'text',
    defaultValue: '',
  },
  {
    key: 'branding.primary_color',
    category: 'Apariencia',
    label: 'Color principal',
    description:
      'El color que identifica al casino: botones, enlaces y detalles. Se elige con el selector de la sección Apariencia.',
    valueType: 'color',
    defaultValue: '#dc2626',
  },
  {
    key: 'branding.logo_url',
    category: 'Marca',
    label: 'Logo',
    description:
      'La imagen del logo del casino. Pegá la URL de una imagen subida a tu host (o usá el botón "Subir" de la sección Marca).',
    valueType: 'url',
  },
  {
    key: 'branding.favicon_url',
    category: 'Marca',
    label: 'Icono de la pestaña',
    description:
      'El ícono que aparece en la pestaña del navegador del jugador. Si está vacío, usa el logo o el ícono de marca.',
    valueType: 'url',
  },
  {
    key: 'site.maintenance_enabled',
    category: 'Sistema',
    label: 'Modo mantenimiento',
    description:
      'Apaga el casino para los jugadores: ven la pantalla de "estamos en mantenimiento" y no pueden jugar. El panel admin sigue funcionando.',
    valueType: 'boolean',
    defaultValue: false,
  },
  {
    key: 'site.registration_enabled',
    category: 'Sistema',
    label: 'Registro de jugadores',
    description:
      'Permite cuentas nuevas. Apagado: los visitantes ven el aviso de "registros cerrados" y el sistema rechaza el registro.',
    valueType: 'boolean',
    defaultValue: true,
  },
  {
    key: 'site.announcement_text',
    category: 'Sistema',
    label: 'Aviso general',
    description:
      'Texto corto arriba de la página del jugador. Ej: "Mantenimiento hoy de 00:00 a 06:00". Vacío = sin aviso.',
    valueType: 'text',
    defaultValue: '',
  },
  {
    key: 'deposits.min_amount',
    category: 'Sistema',
    label: 'Depósito mínimo ($)',
    description:
      'Lo mínimo que puede depositar un jugador, en ARS. Ej: 1000 = no puede depositar menos de $1.000. 0 = sin mínimo.',
    valueType: 'number',
    min: 0,
    defaultValue: 0,
  },
  {
    key: 'withdrawals.min_amount',
    category: 'Sistema',
    label: 'Retiro mínimo ($)',
    description:
      'Lo mínimo que puede retirar un jugador, en ARS. Ej: 500 = no puede retirar menos de $500. 0 = sin mínimo.',
    valueType: 'number',
    min: 0,
    defaultValue: 0,
  },
];

export const KNOWN_SETTINGS_BY_KEY = new Map(
  KNOWN_SETTINGS.map((m) => [m.key, m]),
);
