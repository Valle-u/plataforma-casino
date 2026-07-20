/**
 * Hook compuesto para los KPIs del dashboard.
 *
 * Llama 3 endpoints en paralelo y agrega los resultados. TanStack
 * Query cachea cada uno por separado — si una vista usa solo fraud
 * stats, no se re-fetchea users.
 */

'use client';

import { useQueries } from '@tanstack/react-query';
import { apiGet } from '../api-client';

/**
 * Sprint 56 (perf): el endpoint `/tenant/users/stats` devuelve total +
 * conteo por status en una sola query agregada. Reemplaza las dos
 * llamadas separadas de `limit=1` que hacía el dashboard antes.
 */
interface UsersStatsResponse {
  total: number;
  byStatus: Record<string, number>;
}

export interface FraudStats {
  totalSignals: number;
  suspectedLinks: number;
  confirmedLinks: number;
  dismissedLinks: number;
}

export interface BonusesActiveStats {
  /** El endpoint del backend devuelve un object — capturamos shape parcial. */
  totalActive?: number;
  totalRemainingChips?: string;
  [key: string]: unknown;
}

export interface DashboardStats {
  loading: boolean;
  /** Errores agregados — al menos un endpoint falló. */
  hasError: boolean;
  users: {
    total: number;
    active: number;
  } | null;
  fraud: FraudStats | null;
  bonuses: BonusesActiveStats | null;
  /** Loading individual por query — para que cada KPI muestre skeleton solo si le toca. */
  usersLoading: boolean;
  fraudLoading: boolean;
  bonusesLoading: boolean;
}

export function useDashboardStats(): DashboardStats {
  const results = useQueries({
    queries: [
      {
        queryKey: ['users-stats-dashboard'],
        queryFn: () => apiGet<UsersStatsResponse>('/tenant/users/stats'),
        // Dashboard es una pantalla de lectura que no necesita refrescar
        // constantemente al volver de otra tab. 2 min de data fresca.
        staleTime: 2 * 60_000,
        refetchOnWindowFocus: false,
      },
      {
        queryKey: ['fraud-stats'],
        queryFn: () => apiGet<FraudStats>('/tenant/fraud/stats'),
        staleTime: 2 * 60_000,
        refetchOnWindowFocus: false,
      },
      {
        queryKey: ['bonuses-stats'],
        queryFn: () => apiGet<BonusesActiveStats>('/tenant/bonuses/stats/active'),
        staleTime: 2 * 60_000,
        refetchOnWindowFocus: false,
      },
    ],
  });

  const [usersQ, fraudQ, bonusesQ] = results;

  const loading = results.some((q) => q.isLoading);
  const hasError = results.some((q) => q.isError);

  return {
    loading,
    hasError,
    users: usersQ.data
      ? {
          total: usersQ.data.total,
          active: usersQ.data.byStatus.active ?? 0,
        }
      : null,
    fraud: fraudQ.data ?? null,
    bonuses: bonusesQ.data ?? null,
    usersLoading: usersQ.isLoading,
    fraudLoading: fraudQ.isLoading,
    bonusesLoading: bonusesQ.isLoading,
  };
}
