/**
 * Hook del panel de Tesorería / Casa (Blindaje núcleo económico, Parte B).
 *
 * Endpoint (requiere house.view):
 *   - GET /tenant/house → estado de la Casa (balance, bloqueado).
 *
 * Devuelve 404 HOUSE_NOT_PROVISIONED si el tenant todavía no tiene la Casa
 * provisionada (seed viejo) — la página lo maneja con un estado dedicado.
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch, apiPost } from '../api-client';

export interface HouseState {
  userId: string;
  username: string;
  displayName: string;
  /** Fichas disponibles de la Casa. */
  balance: string;
  /** Fichas bloqueadas de la Casa (holds). */
  lockedBalance: string;
}

export function useHouseState() {
  return useQuery({
    queryKey: ['house-state'],
    queryFn: () => apiGet<HouseState>('/tenant/house'),
    staleTime: 15_000,
    retry: false, // un 404 (no provisionada) no se reintenta.
  });
}

// ──────────────────────────────────────────────────────────────────────
// Aportes de capital (B-build-3)
// ──────────────────────────────────────────────────────────────────────

export interface HouseCapitalInjection {
  id: string;
  /** 'capital' (atado a bank_tx, estricto) | 'budget' (presupuesto, sin bank_tx). */
  type: 'capital' | 'budget';
  amount: string;
  /** Motivo del fondeo. Obligatorio en ambos tipos. */
  reason: string;
  /** NULL cuando type='budget'. */
  bankTransactionId: string | null;
  mintTxId: string | null;
  createdBy: string;
  notes: string | null;
  createdAt: string;
}

export function useCapitalInjections(limit = 50, offset = 0) {
  return useQuery({
    queryKey: ['house-capital-injections', limit, offset],
    queryFn: () =>
      apiGet<{ injections: HouseCapitalInjection[]; total: number }>(
        `/tenant/house/capital-injections?limit=${limit}&offset=${offset}`,
      ),
    staleTime: 15_000,
  });
}

/**
 * Estado del tope mensual de minteo (docs/16 §12).
 *
 * La tesorería es un TOPE MENSUAL de creación de fichas: el setting
 * `treasury.monthly_mint_budget` fija cuántas fichas se pueden mintear por mes.
 * Todos los montos vienen en fichas (strings decimales).
 */
export interface MintBudgetStatus {
  /** Tope mensual configurado. Default gigante (>= 1e11) = "sin límite". */
  monthlyBudget: string;
  /** Fichas ya minteadas en el mes en curso. */
  mintedThisMonth: string;
  /** Disponible restante del mes (monthlyBudget - mintedThisMonth). */
  available: string;
}

/** GET /tenant/house/mint-budget (permiso house.view) — estado del tope mensual. */
export function useMintBudget() {
  return useQuery({
    queryKey: ['house-mint-budget'],
    queryFn: () => apiGet<MintBudgetStatus>('/tenant/house/mint-budget'),
    staleTime: 15_000,
    retry: false,
  });
}

/**
 * Fondea PRESUPUESTO a la Casa (docs/16 §12) — sin bank_tx, motivo obligatorio.
 * El admin fija el monto y el motivo directo. Modelo "banco central".
 *
 * Es el ÚNICO minteo, capado por un tope mensual. Si el monto supera el tope y
 * `fondeo` no viene en true, el backend responde 409 MINT_BUDGET_EXCEEDED. Con
 * `fondeo: true` bypasea el tope (mintea igual, queda auditado).
 *
 * D5: `idempotencyKey` es OBLIGATORIA en el DTO. El caller (el modal) genera
 * un uuid v4 al abrir el form y lo pasa acá. Si el request se retryea (timeout
 * de red, doble click), la misma key permite al backend devolver la injection
 * previa sin doble mint.
 */
export function useInjectBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      amount: string;
      reason: string;
      notes?: string;
      idempotencyKey: string;
      fondeo?: boolean;
    }) => apiPost<HouseCapitalInjection>('/tenant/house/inject-budget', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['house-state'] });
      qc.invalidateQueries({ queryKey: ['house-capital-injections'] });
      qc.invalidateQueries({ queryKey: ['house-mint-budget'] });
      qc.invalidateQueries({ queryKey: ['ledger-supply'] });
      qc.invalidateQueries({ queryKey: ['audit-log'] });
    },
  });
}

/**
 * Genera una idempotency-key UUID v4 (browser-native crypto.randomUUID).
 * Fallback a random hex si el runtime no lo expone. Usada por los forms de
 * la Casa que mutan fichas (inject-budget) para hacer los retries seguros.
 */
export function newHouseIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Array.from({ length: 32 })
    .map(() => Math.floor(Math.random() * 16).toString(16))
    .join('');
}

// ──────────────────────────────────────────────────────────────────────
// Topes de apuesta (B-build-4b)
// ──────────────────────────────────────────────────────────────────────

export interface BettingCapsStatus {
  caps: { playerMonthly: number; globalMonthly: number };
  turnover: { player: string; global: string };
  periodStart: string;
}

export function useBettingCaps() {
  return useQuery({
    queryKey: ['betting-caps'],
    queryFn: () => apiGet<BettingCapsStatus>('/tenant/house/betting-caps'),
    staleTime: 15_000,
  });
}

export function useSetBettingCaps() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { playerMonthly: number; globalMonthly: number }) =>
      apiPatch<BettingCapsStatus>('/tenant/house/betting-caps', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['betting-caps'] });
      qc.invalidateQueries({ queryKey: ['audit-log'] });
    },
  });
}

// ──────────────────────────────────────────────────────────────────────
// Monitoring de tesorería (Fase 4 — panel de alertas)
// ──────────────────────────────────────────────────────────────────────

/** Nivel del bankroll según umbrales configurables en tenant_settings. */
export type StockAlertLevel = 'ok' | 'low' | 'critical';

export interface StockAlertStatus {
  level: StockAlertLevel;
  balance: string;
  thresholdLow: string;
  thresholdCritical: string;
  operatorUserId: string | null;
}

/**
 * Historial del balance de la Casa día por día (gráfica del dashboard).
 */
export interface BalanceHistoryPoint {
  date: string;
  balance: string;
}

/**
 * GET /tenant/house/balance-history?days=N
 */
export function useHouseBalanceHistory(days: number = 30) {
  return useQuery({
    queryKey: ['house-balance-history', days],
    queryFn: () =>
      apiGet<{ history: BalanceHistoryPoint[] }>(
        `/tenant/house/balance-history?days=${days}`,
      ),
    staleTime: 30_000,
    retry: false,
  });
}

/**
 * GET /tenant/house/stock-alert-status
 * @param operatorUserId — si viene, apunta al bankroll del indep en lugar
 * de la Casa. `undefined` = Casa.
 */
export function useHouseStockAlert(operatorUserId?: string | null) {
  const suffix = operatorUserId ? `?operatorUserId=${operatorUserId}` : '';
  return useQuery({
    queryKey: ['house-stock-alert', operatorUserId ?? null],
    queryFn: () =>
      apiGet<StockAlertStatus>(`/tenant/house/stock-alert-status${suffix}`),
    staleTime: 15_000,
    // Auto-refresh cada 30s: si el balance cruza el umbral críticamente,
    // que el banner cambie de color solo (mismo cadence que el resto del panel).
    refetchInterval: 30_000,
    retry: false,
  });
}

export interface CapitalNeeded {
  periodDays: number;
  totalWithdrawals: string;
  totalDeposits: string;
  netOutflow: string;
  currentBalance: string;
  suggestedInject: string;
  operatorUserId: string | null;
}

/**
 * GET /tenant/house/capital-needed?days=N
 * @param days — ventana en días (1–365). Default 30.
 * @param operatorUserId — si viene, apunta a la sub-red del indep.
 */
export function useHouseCapitalNeeded(
  days: number = 30,
  operatorUserId?: string | null,
) {
  const params = new URLSearchParams({ days: String(days) });
  if (operatorUserId) params.set('operatorUserId', operatorUserId);
  return useQuery({
    queryKey: ['house-capital-needed', days, operatorUserId ?? null],
    queryFn: () =>
      apiGet<CapitalNeeded>(`/tenant/house/capital-needed?${params.toString()}`),
    staleTime: 30_000,
    retry: false,
  });
}
