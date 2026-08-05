/**
 * Hooks player-facing del inbox de notificaciones.
 *
 * Endpoints (sin permission especial — solo TenantJwtGuard):
 *   - GET    /tenant/notifications/me?limit=&offset=&onlyUnread=
 *   - GET    /tenant/notifications/me/unread-count
 *   - POST   /tenant/notifications/me/:id/read
 *   - POST   /tenant/notifications/me/read-all
 *
 * El unread count se refetchea cada 30s para mantener el badge "live"
 * sin gastar batería ni red. Las mutations invalidan tanto el listing
 * como el counter.
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../api-client';

export type NotificationChannel = 'in_app' | 'email' | 'sms' | 'web_push';
export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'read';

export interface MyNotification {
  id: string;
  userId: string;
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

interface MyNotificationsResponse {
  data: MyNotification[];
}

export interface MyNotificationsFilters {
  limit?: number;
  offset?: number;
  onlyUnread?: boolean;
}

function buildQuery(filters: MyNotificationsFilters): string {
  const params = new URLSearchParams();
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));
  if (filters.onlyUnread) params.set('onlyUnread', 'true');
  const q = params.toString();
  return q ? `?${q}` : '';
}

export function useMyNotifications(filters: MyNotificationsFilters = {}) {
  return useQuery({
    queryKey: ['my-notifications', filters],
    queryFn: () =>
      apiGet<MyNotificationsResponse>(
        `/tenant/notifications/me${buildQuery(filters)}`,
      ),
    staleTime: 15_000,
  });
}

/**
 * Counter del badge en el header. Refetch cada 30s para que el indicador
 * sea ~live sin polling agresivo. El backend devuelve `{ count: number }`.
 */
export function useMyUnreadCount() {
  return useQuery({
    queryKey: ['my-notifications-unread-count'],
    queryFn: () =>
      apiGet<{ count: number }>('/tenant/notifications/me/unread-count'),
    staleTime: 20_000,
    refetchInterval: 30_000,
    // No refetch on window focus — el background polling ya cubre.
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>): void {
  qc.invalidateQueries({ queryKey: ['my-notifications'] });
  qc.invalidateQueries({ queryKey: ['my-notifications-unread-count'] });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiPost<MyNotification>(`/tenant/notifications/me/${id}/read`, {}),
    onSuccess: () => invalidate(qc),
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiPost<{ updated: number }>(
        '/tenant/notifications/me/read-all',
        {},
      ),
    onSuccess: () => invalidate(qc),
  });
}
