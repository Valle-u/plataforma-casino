/**
 * Hooks de audit log para el panel admin del operador.
 *
 * Endpoint:
 *   - GET /tenant/audit-log
 *
 * Query params soportados (todos opcionales):
 *   - actorUserId, actionCode, actionCodePrefix, targetId
 *   - fromDate / toDate (ISO 8601)
 *   - limit (max 200, default 50), offset, order ('asc'|'desc' default 'desc')
 *
 * Permission: `audit.view`.
 *
 * Notas:
 *   - El audit_log es append-only — no exponemos mutations.
 *   - `before`/`after`/`metadata` son JSON arbitrario por action_code.
 */

'use client';

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../api-client';

export interface AuditEntry {
  id: string;
  actorUserId: string | null;
  actorUsername: string | null;
  actorRoleAtTime: string | null;
  actionCode: string;
  targetType: string | null;
  targetId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  metadata: unknown;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  sessionId: string | null;
  impersonatorId: string | null;
  createdAt: string;
}

export interface AuditFilters {
  actorUserId?: string;
  actionCode?: string;
  actionCodePrefix?: string;
  targetId?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
  order?: 'asc' | 'desc';
}

interface AuditListResponse {
  entries: AuditEntry[];
  total: number;
  limit: number;
  offset: number;
}

function buildQuery(filters: AuditFilters): string {
  const params = new URLSearchParams();
  if (filters.actorUserId) params.set('actorUserId', filters.actorUserId);
  if (filters.actionCode) params.set('actionCode', filters.actionCode);
  if (filters.actionCodePrefix) {
    params.set('actionCodePrefix', filters.actionCodePrefix);
  }
  if (filters.targetId) params.set('targetId', filters.targetId);
  if (filters.fromDate) params.set('fromDate', filters.fromDate);
  if (filters.toDate) params.set('toDate', filters.toDate);
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));
  if (filters.order) params.set('order', filters.order);
  const q = params.toString();
  return q ? `?${q}` : '';
}

export function useAuditLog(filters: AuditFilters) {
  return useQuery({
    queryKey: ['audit-log', filters],
    queryFn: () =>
      apiGet<AuditListResponse>(`/tenant/audit-log${buildQuery(filters)}`),
    staleTime: 10_000,
    placeholderData: (prev) => prev,
  });
}
