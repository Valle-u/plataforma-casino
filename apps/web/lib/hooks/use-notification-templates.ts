/**
 * Hooks de notification templates para el panel admin.
 *
 * Endpoints:
 *   - GET    /tenant/notification-templates             → lista overrides
 *   - GET    /tenant/notification-templates/kinds       → kinds registrados
 *   - GET    /tenant/notification-templates/:kind       → uno (404 si no hay override)
 *   - POST   /tenant/notification-templates/:kind/preview → render con payload de prueba
 *   - PATCH  /tenant/notification-templates/:kind       → upsert
 *   - DELETE /tenant/notification-templates/:kind       → unset (vuelve a default)
 *
 * Todos requieren `tenant.notifications.templates.edit`.
 *
 * Concepto:
 *   - `defaults` viven hardcoded en el código del backend. Cada `kind` tiene
 *     un default subject/body con variables `{{ user.username }}` etc.
 *   - El admin puede crear un `override` en DB con subject/body custom.
 *     Si `enabled=true`, el render usa el override; sino el default.
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPatch, apiPost } from '../api-client';

export interface TemplateOverrideRow {
  id: string;
  kind: string;
  subjectTemplate: string;
  bodyTemplate: string;
  enabled: boolean;
  updatedByUserId: string | null;
  updatedAt: string;
  createdAt: string;
}

interface TemplatesListResponse {
  data: TemplateOverrideRow[];
}

export function useTemplateOverrides() {
  return useQuery({
    queryKey: ['notification-template-overrides'],
    queryFn: () =>
      apiGet<TemplatesListResponse>('/tenant/notification-templates'),
    staleTime: 30_000,
  });
}

interface KindsResponse {
  data: string[];
}

export function useTemplateKinds() {
  return useQuery({
    queryKey: ['notification-template-kinds'],
    queryFn: () =>
      apiGet<KindsResponse>('/tenant/notification-templates/kinds'),
    staleTime: 5 * 60_000, // cambian solo en deploy
  });
}

export function useTemplateOverride(kind: string | null) {
  return useQuery({
    queryKey: ['notification-template-override', kind],
    queryFn: () =>
      apiGet<TemplateOverrideRow>(`/tenant/notification-templates/${kind}`),
    enabled: !!kind,
    staleTime: 15_000,
    // Si no hay override, el backend devuelve 404 — lo manejamos en la UI
    // como "default activo". TanStack Query lo deja en `isError` con 404.
    retry: false,
  });
}

// ──────────────────────────────────────────────────────────────────────
// Preview (no muta)
// ──────────────────────────────────────────────────────────────────────

export interface TemplatePreviewPayload {
  payload: Record<string, unknown>;
  /** Si están, hace preview del DRAFT (no del override actual). */
  subjectTemplate?: string;
  bodyTemplate?: string;
}

export interface TemplatePreviewResponse {
  source: 'draft' | 'override' | 'default';
  subject: string;
  body: string;
}

export function usePreviewTemplate() {
  return useMutation({
    mutationFn: ({
      kind,
      payload,
      subjectTemplate,
      bodyTemplate,
    }: TemplatePreviewPayload & { kind: string }) =>
      apiPost<TemplatePreviewResponse>(
        `/tenant/notification-templates/${kind}/preview`,
        { payload, subjectTemplate, bodyTemplate },
      ),
  });
}

// ──────────────────────────────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────────────────────────────

function invalidate(
  qc: ReturnType<typeof useQueryClient>,
  kind?: string,
): void {
  qc.invalidateQueries({ queryKey: ['notification-template-overrides'] });
  qc.invalidateQueries({ queryKey: ['audit-log'] });
  if (kind) {
    qc.invalidateQueries({
      queryKey: ['notification-template-override', kind],
    });
  }
}

export interface UpsertTemplatePayload {
  kind: string;
  subjectTemplate: string;
  bodyTemplate: string;
  enabled?: boolean;
}

export function useUpsertTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, ...body }: UpsertTemplatePayload) =>
      apiPatch<TemplateOverrideRow>(
        `/tenant/notification-templates/${kind}`,
        body,
      ),
    onSuccess: (_data, vars) => invalidate(qc, vars.kind),
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (kind: string) =>
      apiDelete<void>(`/tenant/notification-templates/${kind}`),
    onSuccess: (_data, kind) => invalidate(qc, kind),
  });
}
