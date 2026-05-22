/**
 * Hooks de notifications para el panel admin (queue outbound).
 *
 * Endpoint admin:
 *   - GET /tenant/notifications (permission notifications.view_any)
 *
 * Hay otro file `use-notifications.ts` (futuro) que cubre user-facing
 * (`/me`, `/me/unread-count`, etc.) — distinto. Acá solo el queue del admin
 * para diagnosticar entregas y filtrar por status/channel/kind/user.
 *
 * `subject` y `body` son snapshot pre-renderizado al enqueue (si cambian
 * los templates después, las notifs viejas conservan el render del momento).
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../api-client';

export type NotificationChannel = 'in_app' | 'email' | 'sms';
export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'read';

export interface NotificationRow {
  id: string;
  userId: string;
  userUsername: string | null;
  userDisplayName: string | null;
  kind: string;
  channel: NotificationChannel;
  payload: Record<string, unknown>;
  subject: string;
  body: string;
  status: NotificationStatus;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
  readAt: string | null;
}

export interface NotificationsAdminFilters {
  statuses?: NotificationStatus[];
  channels?: NotificationChannel[];
  kind?: string;
  userId?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
}

interface NotificationsListResponse {
  data: NotificationRow[];
  total: number;
}

function buildQuery(filters: NotificationsAdminFilters): string {
  const params = new URLSearchParams();
  if (filters.statuses && filters.statuses.length > 0) {
    params.set('statuses', filters.statuses.join(','));
  }
  if (filters.channels && filters.channels.length > 0) {
    params.set('channels', filters.channels.join(','));
  }
  if (filters.kind) params.set('kind', filters.kind);
  if (filters.userId) params.set('userId', filters.userId);
  if (filters.fromDate) params.set('fromDate', filters.fromDate);
  if (filters.toDate) params.set('toDate', filters.toDate);
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));
  const q = params.toString();
  return q ? `?${q}` : '';
}

export function useNotificationsAdmin(filters: NotificationsAdminFilters) {
  return useQuery({
    queryKey: ['notifications-admin', filters],
    queryFn: () =>
      apiGet<NotificationsListResponse>(
        `/tenant/notifications${buildQuery(filters)}`,
      ),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });
}

// ──────────────────────────────────────────────────────────────────────
// Retry mutation
// ──────────────────────────────────────────────────────────────────────

/**
 * Re-encola una notification que está en `failed` → status=pending.
 * El backend valida que el current status sea 'failed'; sino tira 404
 * con error 'NOTIFICATION_NOT_RETRIABLE'.
 *
 * Después del retry, el dispatcher cron la procesa en su próximo run
 * (NO es envío inmediato). Si la causa del fail original sigue (e.g.
 * user sin email), volverá a quedar failed.
 */
export function useRetryNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiPost<NotificationRow>(`/tenant/notifications/${id}/retry`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications-admin'] });
      qc.invalidateQueries({ queryKey: ['audit-log'] });
    },
  });
}

// ──────────────────────────────────────────────────────────────────────
// Sprint 51.10: stats agregados del panel de notificaciones.
// ──────────────────────────────────────────────────────────────────────

export interface NotificationsStatsResponse {
  windowDays: number;
  total: number;
  byStatus: Record<string, number>;
  byChannel: Array<{
    channel: string;
    sent: number;
    failed: number;
    pending: number;
    successRate: number;
  }>;
  topKinds: Array<{ kind: string; count: number }>;
}

export function useNotificationsStats(windowDays = 7) {
  return useQuery({
    queryKey: ['notifications-stats', windowDays],
    queryFn: () =>
      apiGet<NotificationsStatsResponse>(
        `/tenant/notifications/stats?windowDays=${windowDays}`,
      ),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}
