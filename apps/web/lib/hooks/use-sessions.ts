/**
 * Hooks player-facing de sesiones activas — "Mis dispositivos".
 *
 * Endpoints (TenantJwtGuard, sin permiso especial):
 *   - GET    /tenant/auth/sessions         — lista sesiones activas del user.
 *   - DELETE /tenant/auth/sessions/:id     — revoca una sesión propia.
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet } from '../api-client';

export interface ActiveSession {
  id: string;
  deviceLabel: string;
  ip: string | null;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
  impersonatedBy: string | null;
}

interface SessionsResponse {
  sessions: ActiveSession[];
}

export function useMySessions() {
  return useQuery({
    queryKey: ['my-sessions'],
    queryFn: () => apiGet<SessionsResponse>('/tenant/auth/sessions'),
    staleTime: 30_000,
  });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      apiDelete(`/tenant/auth/sessions/${sessionId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['my-sessions'] });
    },
  });
}
