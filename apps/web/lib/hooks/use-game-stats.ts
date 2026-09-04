/**
 * Hooks de game-stats (Sprint 46).
 *
 * Endpoints read-only:
 *   - GET /tenant/game-stats/rounds       (game_stats.view_own_network)
 *   - GET /tenant/game-stats/rounds/:id   detalle de una ronda
 *   - GET /tenant/game-stats/summary
 *   - GET /tenant/game-stats/by-game
 *   - GET /tenant/game-stats/by-player
 *   - GET /tenant/game-stats/export       (game_stats.export)
 */

'use client';

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../api-client';

export type RoundStatus = 'placed' | 'settled' | 'rolled_back';

export interface RoundRow {
  id: string;
  sessionId: string;
  gameCode: string;
  gameName: string;
  providerCode: string;
  userId: string;
  username: string;
  displayName: string;
  status: RoundStatus;
  betAmount: string;
  winAmount: string;
  netAmount: string;
  roundExternalId: string;
  balanceAfter: string | null;
  placedAt: string;
  settledAt: string | null;
  rolledBackAt: string | null;
  outcome: 'win' | 'loss' | 'zero';
}

export interface RoundsPage {
  data: RoundRow[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface RoundsFilters {
  gameCode?: string;
  userId?: string;
  sessionId?: string;
  status?: RoundStatus;
  dateFrom?: string;
  dateTo?: string;
  minBet?: number;
  maxBet?: number;
  outcome?: 'win' | 'loss' | 'zero';
  limit?: number;
  offset?: number;
}

function buildQuery(filters: object): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters as Record<string, unknown>)) {
    if (v === undefined || v === null || v === '') continue;
    if (typeof v === 'string') params.set(k, v);
    else if (typeof v === 'number' || typeof v === 'boolean')
      params.set(k, String(v));
  }
  const q = params.toString();
  return q ? `?${q}` : '';
}

export function useGameRounds(filters: RoundsFilters = {}) {
  return useQuery({
    queryKey: ['game-stats-rounds', filters],
    queryFn: () =>
      apiGet<RoundsPage>(`/tenant/game-stats/rounds${buildQuery(filters)}`),
    staleTime: 30_000,
  });
}

/** Un movimiento de fichas ligado a la ronda. */
export interface RoundWalletTx {
  id: string;
  type: string;
  amount: string;
  balanceAfter: string;
  bonusBalanceAfter: string | null;
  source: string | null;
  reason: string | null;
  idempotencyKey: string | null;
  createdAt: string;
}

/** Fila cruda del proveedor, con SU id de transacción. */
export interface ProviderTxRow {
  idLabel: string;
  externalId: string;
  amount: string | null;
  kind: string | null;
  createdAt: string;
  extra: Record<string, unknown>;
}

export interface RoundDetail {
  round: RoundRow & {
    action: string | null;
    payload: unknown;
    autoSettledReason: string | null;
    betWalletTxId: string | null;
    winWalletTxId: string | null;
    rollbackWalletTxId: string | null;
  };
  session: {
    id: string;
    providerSessionId: string | null;
    startedAt: string;
    endedAt: string | null;
    openedFromIp: string | null;
  } | null;
  walletTxs: {
    bet: RoundWalletTx | null;
    win: RoundWalletTx | null;
    rollback: RoundWalletTx | null;
  };
  providerTxs: ProviderTxRow[];
}

export function useRoundDetail(id: string | null) {
  return useQuery({
    queryKey: ['game-stats-round-detail', id],
    queryFn: () => apiGet<RoundDetail>(`/tenant/game-stats/rounds/${id ?? ''}`),
    enabled: Boolean(id),
    // Una ronda cerrada no cambia; una abierta puede settlearse. 30s alcanza
    // para no re-pedirla al navegar y sigue reflejando un settle reciente.
    staleTime: 30_000,
    retry: false,
  });
}

export interface SummaryFilters {
  dateFrom?: string;
  dateTo?: string;
}

export type BucketKey = 'today' | '7d' | '30d' | 'custom';

export interface GameStatsSummary {
  bucket: BucketKey;
  dateFrom: string;
  dateTo: string;
  totalBet: string;
  totalWin: string;
  ggr: string;
  rtpRealPct: string;
  roundsCount: number;
  uniquePlayers: number;
  rolledBackCount: number;
}

export function useGameStatsSummary(filters: SummaryFilters = {}) {
  return useQuery({
    queryKey: ['game-stats-summary', filters],
    queryFn: () =>
      apiGet<GameStatsSummary>(`/tenant/game-stats/summary${buildQuery(filters)}`),
    staleTime: 60_000,
  });
}

export interface ReconciliationBucket {
  count: number;
  bet: string;
  win: string;
}

export interface GameStatsReconciliation {
  dateFrom: string;
  dateTo: string;
  byPlacedAt: { settled: ReconciliationBucket; inFlight: ReconciliationBucket };
  bySettledAt: { settled: ReconciliationBucket };
  oldestInFlightAgeHours: number | null;
}

/**
 * Diagnóstico de reconciliación — por qué el netwin de esta página puede no
 * coincidir con Estadísticas de pago/Comisiones/el Resumen financiero
 * (mismo rango de fechas que `useGameStatsSummary`).
 */
export function useGameStatsReconciliation(filters: SummaryFilters = {}, enabled = true) {
  return useQuery({
    queryKey: ['game-stats-reconciliation', filters],
    queryFn: () =>
      apiGet<GameStatsReconciliation>(
        `/tenant/game-stats/reconciliation${buildQuery(filters)}`,
      ),
    enabled,
    staleTime: 60_000,
  });
}

export interface ByGameRow {
  gameId: string;
  gameCode: string;
  gameName: string;
  rtpTargetPct: number | null;
  totalBet: string;
  totalWin: string;
  ggr: string;
  rtpRealPct: string;
  rtpDivergencePts: string | null;
  flagged: boolean;
  roundsCount: number;
  uniquePlayers: number;
}

export function useGameStatsByGame(filters: SummaryFilters = {}) {
  return useQuery({
    queryKey: ['game-stats-by-game', filters],
    queryFn: () =>
      apiGet<ByGameRow[]>(`/tenant/game-stats/by-game${buildQuery(filters)}`),
    staleTime: 60_000,
  });
}

export interface ByPlayerRow {
  userId: string;
  username: string;
  displayName: string;
  totalBet: string;
  totalWin: string;
  netAmount: string;
  roundsCount: number;
}

export interface ByPlayerFilters extends SummaryFilters {
  limit?: number;
}

export function useGameStatsByPlayer(filters: ByPlayerFilters = {}) {
  return useQuery({
    queryKey: ['game-stats-by-player', filters],
    queryFn: () =>
      apiGet<ByPlayerRow[]>(`/tenant/game-stats/by-player${buildQuery(filters)}`),
    staleTime: 60_000,
  });
}

export function buildGameStatsExportUrl(filters: object): string {
  return `/tenant/game-stats/export${buildQuery(filters)}`;
}

export const ROUND_STATUS_LABELS: Record<RoundStatus, string> = {
  placed: 'En curso',
  settled: 'Cerrada',
  rolled_back: 'Revertida',
};
