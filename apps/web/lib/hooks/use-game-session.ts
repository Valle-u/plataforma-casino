/**
 * Hooks player-facing del game loop (Sprint 35).
 *
 * Endpoints:
 *   - POST /tenant/games/code/:code/launch
 *   - POST /tenant/games/sessions/:id/bet
 *   - POST /tenant/games/sessions/:id/close
 *   - GET  /tenant/games/sessions/active
 *   - GET  /tenant/games/sessions/:id/rounds
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../api-client';

export type GameSessionStatus = 'active' | 'closed' | 'expired';
export type GameRoundStatus = 'placed' | 'settled' | 'rolled_back';

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

export interface GameRound {
  id: string;
  sessionId: string;
  userId: string;
  gameId: string;
  roundExternalId: string;
  betAmount: string;
  winAmount: string;
  netAmount: string;
  status: GameRoundStatus;
  betWalletTxId: string | null;
  winWalletTxId: string | null;
  payload: Record<string, unknown> & {
    rng?: number;
    multiplier?: number;
    reels?: string[];
  };
  placedAt: string;
  settledAt: string | null;
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

export interface PlaceBetPayload {
  amount: string;
  /** Marca de idempotencia por giro — evita doble apuesta por doble clic/reintento. */
  clientRoundId: string;
}

export function usePlaceBet(sessionId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: PlaceBetPayload) => {
      if (!sessionId) throw new Error('sessionId requerido');
      return apiPost<GameRound>(
        `/tenant/games/sessions/${sessionId}/bet`,
        payload,
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-wallet'] });
      qc.invalidateQueries({ queryKey: ['my-transactions'] });
      qc.invalidateQueries({ queryKey: ['session-rounds', sessionId] });
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

export function useSessionRounds(sessionId: string | null, limit = 50) {
  return useQuery({
    queryKey: ['session-rounds', sessionId, limit],
    queryFn: () => {
      if (!sessionId) throw new Error('sessionId requerido');
      return apiGet<{ data: GameRound[] }>(
        `/tenant/games/sessions/${sessionId}/rounds?limit=${limit}`,
      );
    },
    enabled: !!sessionId,
    staleTime: 15_000,
  });
}
