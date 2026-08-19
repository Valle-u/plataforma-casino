/**
 * Hooks player-facing del lifecycle de sesión (seamless).
 *
 * Los proveedores reales (Palace, Forever) son seamless: la apuesta y el
 * settle ocurren dentro del iframe del proveedor y se reconcilian por
 * callback. Acá solo manejamos el lifecycle de la sesión (launch/close).
 *
 * Endpoints:
 *   - POST /tenant/games/code/:code/launch
 *   - POST /tenant/games/sessions/:id/close
 *   - GET  /tenant/games/sessions/active
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../api-client';

export type GameSessionStatus = 'active' | 'closed' | 'expired';

export interface GameSession {
  id: string;
  userId: string;
  gameId: string;
  providerSessionId: string;
  currency: string;
  openedBalance: string;
  closingBalance: string | null;
  status: GameSessionStatus;
  startedAt: string;
  endedAt: string | null;
}

export interface LaunchResponse {
  sessionId: string;
  launchUrl: string;
  openedBalance: string;
}

export function useLaunchGame() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) =>
      apiPost<LaunchResponse>(
        `/tenant/games/code/${encodeURIComponent(code)}/launch`,
        {},
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['active-sessions'] });
    },
  });
}

export function useCloseSession(sessionId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => {
      if (!sessionId) throw new Error('sessionId requerido');
      return apiPost<GameSession>(
        `/tenant/games/sessions/${sessionId}/close`,
        {},
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['active-sessions'] });
      qc.invalidateQueries({ queryKey: ['my-wallet'] });
    },
  });
}

export function useActiveSessions() {
  return useQuery({
    queryKey: ['active-sessions'],
    queryFn: () => apiGet<{ data: GameSession[] }>('/tenant/games/sessions/active'),
    staleTime: 30_000,
  });
}
