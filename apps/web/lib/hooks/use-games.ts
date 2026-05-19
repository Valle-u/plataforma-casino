/**
 * Hooks player-facing del catálogo de games (Sprint 34).
 *
 * Endpoints:
 *   - GET /tenant/games/active?category=&featuredOnly=
 *   - GET /tenant/games/code/:code
 *
 * Sprint 35 sumará useLaunchGame + bet/win/rollback hooks.
 */

'use client';

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../api-client';

export type GameCategory = 'slots' | 'live' | 'crash' | 'table';

export interface PlayerGame {
  id: string;
  code: string;
  name: string;
  providerCode: string;
  category: GameCategory;
  thumbnailUrl: string | null;
  shortDescription: string | null;
  config: Record<string, unknown>;
  featured: boolean;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ListResponse {
  data: PlayerGame[];
}

export interface ListGamesFilters {
  category?: GameCategory;
  featuredOnly?: boolean;
}

function buildQuery(f: ListGamesFilters): string {
  const params = new URLSearchParams();
  if (f.category) params.set('category', f.category);
  if (f.featuredOnly) params.set('featuredOnly', 'true');
  const q = params.toString();
  return q ? `?${q}` : '';
}

export function useActiveGames(filters: ListGamesFilters = {}) {
  return useQuery({
    queryKey: ['active-games', filters],
    queryFn: () =>
      apiGet<ListResponse>(`/tenant/games/active${buildQuery(filters)}`),
    staleTime: 60_000,
  });
}

export function useGameByCode(code: string | null) {
  return useQuery({
    queryKey: ['game-by-code', code],
    queryFn: () => {
      if (!code) throw new Error('code requerido');
      return apiGet<PlayerGame>(`/tenant/games/code/${code}`);
    },
    enabled: !!code,
    staleTime: 60_000,
  });
}
