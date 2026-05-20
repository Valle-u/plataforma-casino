/**
 * Hooks de wallet-stats (Sprint 45).
 *
 * Endpoints read-only:
 *   - GET /tenant/wallet-stats/movements   (wallet_stats.view_own_network)
 *   - GET /tenant/wallet-stats/summary
 *   - GET /tenant/wallet-stats/by-role
 *   - GET /tenant/wallet-stats/export      (wallet_stats.export)
 */

'use client';

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../api-client';

export type WalletTxType =
  | 'mint' | 'burn' | 'load' | 'unload'
  | 'transfer_in' | 'transfer_out'
  | 'bet' | 'win' | 'rollback' | 'adjustment'
  | 'bonus_grant' | 'bonus_clear' | 'bonus_forfeit'
  | 'bonus_funding' | 'bonus_funding_revert'
  | 'deposit' | 'withdrawal'
  | 'jackpot_win' | 'promo_reward' | 'league_reward'
  | 'commission_payout' | 'fund_reserve' | 'fund_release';

export interface MovementRow {
  id: string;
  type: WalletTxType;
  amount: string;
  balanceAfter: string;
  createdAt: string; // ISO
  source: string | null;
  reason: string | null;
  notes: string | null;
  idempotencyKey: string | null;
  ownerUserId: string;
  ownerUsername: string;
  ownerDisplayName: string;
  ownerRole: string | null;
  actorUserId: string | null;
  actorUsername: string | null;
  actorRole: string | null;
  counterpartyUserId: string | null;
  direction: 'in' | 'out';
}

export interface MovementsPage {
  data: MovementRow[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface MovementsFilters {
  type?: WalletTxType | WalletTxType[];
  ownerRole?: string | string[];
  dateFrom?: string; // ISO
  dateTo?: string;
  userId?: string;
  actorId?: string;
  minAmount?: number;
  maxAmount?: number;
  limit?: number;
  offset?: number;
}

function buildQuery(filters: MovementsFilters): string {
  const params = new URLSearchParams();
  if (filters.type) {
    const arr = Array.isArray(filters.type) ? filters.type : [filters.type];
    arr.forEach((t) => params.append('type', t));
  }
  if (filters.ownerRole) {
    const arr = Array.isArray(filters.ownerRole)
      ? filters.ownerRole
      : [filters.ownerRole];
    arr.forEach((r) => params.append('ownerRole', r));
  }
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  if (filters.userId) params.set('userId', filters.userId);
  if (filters.actorId) params.set('actorId', filters.actorId);
  if (filters.minAmount !== undefined)
    params.set('minAmount', String(filters.minAmount));
  if (filters.maxAmount !== undefined)
    params.set('maxAmount', String(filters.maxAmount));
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));
  const q = params.toString();
  return q ? `?${q}` : '';
}

export function useWalletStatsMovements(filters: MovementsFilters = {}) {
  return useQuery({
    queryKey: ['wallet-stats-movements', filters],
    queryFn: () =>
      apiGet<MovementsPage>(`/tenant/wallet-stats/movements${buildQuery(filters)}`),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

// ──────────────────────────────────────────────────────────────────────
// Summary
// ──────────────────────────────────────────────────────────────────────

export type BucketKey = 'today' | '7d' | '30d' | 'custom';

export interface SummaryBucket {
  bucket: BucketKey;
  dateFrom: string;
  dateTo: string;
  totalIn: string;
  totalOut: string;
  net: string;
  txCount: number;
  countByType: Record<string, number>;
  amountByType: Record<string, string>;
}

export interface SummaryFilters {
  dateFrom?: string;
  dateTo?: string;
}

function buildSummaryQuery(filters: SummaryFilters): string {
  const params = new URLSearchParams();
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  const q = params.toString();
  return q ? `?${q}` : '';
}

export function useWalletStatsSummary(filters: SummaryFilters = {}) {
  return useQuery({
    queryKey: ['wallet-stats-summary', filters],
    queryFn: () =>
      apiGet<SummaryBucket>(`/tenant/wallet-stats/summary${buildSummaryQuery(filters)}`),
    staleTime: 60_000,
  });
}

// ──────────────────────────────────────────────────────────────────────
// By Role
// ──────────────────────────────────────────────────────────────────────

export interface ByRoleRow {
  role: string;
  inflow: string;
  outflow: string;
  net: string;
  txCount: number;
  uniqueUsers: number;
}

export function useWalletStatsByRole(filters: SummaryFilters = {}) {
  return useQuery({
    queryKey: ['wallet-stats-by-role', filters],
    queryFn: () =>
      apiGet<ByRoleRow[]>(`/tenant/wallet-stats/by-role${buildSummaryQuery(filters)}`),
    staleTime: 60_000,
  });
}

// ──────────────────────────────────────────────────────────────────────
// Catálogo + helpers UI
// ──────────────────────────────────────────────────────────────────────

/**
 * Tipos agrupados por categoría para los filtros de la UI.
 * Mantener en sync con el enum `walletTxTypeEnum` del backend.
 */
export const TX_TYPE_GROUPS: Array<{ label: string; types: WalletTxType[] }> = [
  {
    label: 'Operaciones',
    types: ['load', 'unload', 'transfer_in', 'transfer_out', 'deposit', 'withdrawal'],
  },
  {
    label: 'Sistema',
    types: ['mint', 'burn', 'adjustment', 'rollback'],
  },
  {
    label: 'Juego',
    types: ['bet', 'win', 'jackpot_win', 'fund_reserve', 'fund_release'],
  },
  {
    label: 'Bonos & promos',
    types: [
      'bonus_grant', 'bonus_clear', 'bonus_forfeit',
      'bonus_funding', 'bonus_funding_revert',
      'promo_reward', 'league_reward',
    ],
  },
  {
    label: 'Comisiones',
    types: ['commission_payout'],
  },
];

export const TX_TYPE_LABELS: Record<WalletTxType, string> = {
  mint: 'Mint (crear fichas)',
  burn: 'Burn (destruir fichas)',
  load: 'Carga manual',
  unload: 'Descarga manual',
  transfer_in: 'Transferencia recibida',
  transfer_out: 'Transferencia enviada',
  bet: 'Apuesta',
  win: 'Pago de juego',
  rollback: 'Rollback',
  adjustment: 'Ajuste',
  bonus_grant: 'Bono otorgado',
  bonus_clear: 'Bono liberado',
  bonus_forfeit: 'Bono perdido',
  bonus_funding: 'Bono financiado',
  bonus_funding_revert: 'Reversa financiación bono',
  deposit: 'Depósito (aprobado)',
  withdrawal: 'Retiro (pagado)',
  jackpot_win: 'Jackpot ganado',
  promo_reward: 'Premio promoción',
  league_reward: 'Premio liga',
  commission_payout: 'Comisión',
  fund_reserve: 'Reserva (hold)',
  fund_release: 'Release de reserva',
};

export const ROLE_LABELS: Record<string, string> = {
  admin_tenant: 'Admin tenant',
  socio: 'Socio',
  distribuidor: 'Distribuidor',
  cajero: 'Cajero',
  empleado: 'Empleado',
  usuario_final: 'Jugador',
  sin_rol: 'Sin rol',
};

/** URL listo para link directo al export con los filtros aplicados. */
export function buildExportUrl(filters: MovementsFilters): string {
  return `/tenant/wallet-stats/export${buildQuery(filters)}`;
}
