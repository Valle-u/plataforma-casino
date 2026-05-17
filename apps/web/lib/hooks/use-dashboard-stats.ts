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
 * El backend ya soporta filtros server-side desde Sprint 14 — el dashboard
 * pide solo el COUNT (`limit=1`) en dos pasadas: total y solo activos.
 * Mucho más liviano que traer toda la lista para filtrar client-side.
 */
interface UsersCountResponse {
  total: number;
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
}

export function useDashboardStats(): DashboardStats {
  const results = useQueries({
    queries: [
      {
        queryKey: ['users-list-dashboard', 'total'],
        queryFn: () => apiGet<UsersCountResponse>('/tenant/users?limit=1'),
      },
      {
        queryKey: ['users-list-dashboard', 'active'],
        queryFn: () =>
          apiGet<UsersCountResponse>('/tenant/users?status=active&limit=1'),
      },
      {
        queryKey: ['fraud-stats'],
        queryFn: () => apiGet<FraudStats>('/tenant/fraud/stats'),
      },
      {
        queryKey: ['bonuses-stats'],
        queryFn: () => apiGet<BonusesActiveStats>('/tenant/bonuses/stats/active'),
      },
    ],
  });

  const [usersTotalQ, usersActiveQ, fraudQ, bonusesQ] = results;

  const loading = results.some((q) => q.isLoading);
  const hasError = results.some((q) => q.isError);

  return {
    loading,
    hasError,
    users:
      usersTotalQ.data && usersActiveQ.data
        ? {
            total: usersTotalQ.data.total,
            active: usersActiveQ.data.total,
          }
        : null,
    fraud: fraudQ.data ?? null,
    bonuses: bonusesQ.data ?? null,
  };
}
