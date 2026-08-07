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
  | 'bonus_credit' | 'bonus_debit'
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
  totalIn: string;
  totalOut: string;
  net: string;
  totalBet: string;
  totalWon: string;
  netGaming: string;
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
    label: 'Saldo bonus',
    types: ['bonus_credit', 'bonus_debit'],
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

/** Nombres cortos para los botones del filtro. */
export const TX_TYPE_LABELS: Record<WalletTxType, string> = {
  mint: 'Creación',
  burn: 'Destrucción',
  load: 'Carga',
  unload: 'Descarga',
  transfer_in: 'Transf. entrada',
  transfer_out: 'Transf. salida',
  bet: 'Apuesta',
  win: 'Ganancia',
  rollback: 'Rollback',
  adjustment: 'Ajuste',
  bonus_grant: 'Bono otorgado',
  bonus_clear: 'Bono liberado',
  bonus_forfeit: 'Bono perdido',
  bonus_funding: 'Financiamiento',
  bonus_funding_revert: 'Reversa financiam.',
  bonus_credit: 'Crédito bonus',
  bonus_debit: 'Débito bonus',
  deposit: 'Depósito',
  withdrawal: 'Retiro',
  jackpot_win: 'Jackpot',
  promo_reward: 'Premio promo',
  league_reward: 'Premio liga',
  commission_payout: 'Comisión',
  fund_reserve: 'Reserva',
  fund_release: 'Liberación reserva',
};

/** Descripciones detalladas para tooltips (hover). */
export const TX_TYPE_DESCRIPTIONS: Record<WalletTxType, string> = {
  mint: 'Creación de fichas por el sistema o un admin. Las fichas aparecen en el wallet del usuario sin contrapartida.',
  burn: 'Destrucción de fichas del wallet. Usado para limpiar saldo o corregir errores.',
  load: 'Carga manual de fichas por cajero o admin. El usuario recibe fichas en su wallet.',
  unload: 'Descarga manual de fichas. Un cajero retira fichas del wallet del usuario.',
  transfer_in: 'Transferencia recibida de otro usuario del mismo tenant.',
  transfer_out: 'Transferencia enviada a otro usuario del mismo tenant.',
  bet: 'Apuesta en un juego (slots, crash, etc.). Las fichas se queman del wallet del jugador.',
  win: 'Ganancia de un juego. Las fichas se acreditan al wallet del jugador.',
  rollback: 'Reversa de una apuesta o ganancia. Se devuelve el monto original al wallet.',
  adjustment: 'Ajuste manual hecho por un admin para corregir un error en el saldo.',
  bonus_grant: 'Bono otorgado al usuario (por depósito, promo, etc.). Se acredita al bonus balance.',
  bonus_clear: 'Bono liberado: el saldo bonus se convierte en saldo real y queda disponible para retiro.',
  bonus_forfeit: 'Bono perdido por incumplir condiciones (rollover, expiración, etc.). Se descuenta del bonus balance.',
  bonus_funding: 'Financiamiento de bono: el casino transfiere fondos para cubrir el bono.',
  bonus_funding_revert: 'Reversa del financiamiento de bono. Se revierte la transferencia anterior.',
  bonus_credit: 'Crédito al bonus balance: se suman fichas bonus al wallet del usuario.',
  bonus_debit: 'Débito del bonus balance: se descuentan fichas bonus del wallet. Se usa al apostar con saldo bonus.',
  deposit: 'Depósito aprobado por un cajero. Las fichas se acreditan al wallet del jugador.',
  withdrawal: 'Retiro aprobado y pagado. Las fichas se debitan del wallet del jugador.',
  jackpot_win: 'Premio de jackpot ganado por el jugador. Se acredita al wallet.',
  promo_reward: 'Premio de una promoción activa (sorteo, torneo, etc.).',
  league_reward: 'Premio por posición en una liga o competencia.',
  commission_payout: 'Pago de comisión a un cajero o distribuidor por ventas de su red.',
  fund_reserve: 'Reserva de fondos (hold). Se bloquea una parte del saldo del wallet.',
  fund_release: 'Liberación de reserva. El saldo bloqueado se devuelve al wallet.',
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
