/**
 * Hooks del catálogo de juegos (panel admin, tab "Juegos" de Game Providers).
 *
 *   GET   /tenant/games?category=&status=&search=&providerCode=&limit=&offset=
 *   PATCH /tenant/games/:id     → flags (oculto/deshabilitado/destacado/orden).
 *   POST  /tenant/games/bulk    → flags en lote.
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch, apiPost } from '@/lib/api-client';

export type GameCategory = 'slots' | 'live' | 'crash' | 'table' | 'mini';
export type GameStatus = 'visible' | 'hidden' | 'disabled' | 'inactive';

export interface AdminGame {
  id: string;
  code: string;
  name: string;
  providerCode: string;
  category: GameCategory;
  thumbnailUrl: string | null;
  shortDescription: string | null;
  featured: boolean;
  sortOrder: number;
  palaceProviderId: number | null;
  palaceGameSymbol: string | null;
  isActive: boolean;
  isHidden: boolean;
  isDisabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GameMetrics {
  rounds: number;
  ggr: string;
  lastPlayedAt: string | null;
}

export interface AdminGamesResponse {
  data: AdminGame[];
  total: number;
  metrics: Record<string, GameMetrics>;
}

export interface AdminGamesFilters {
  category?: GameCategory;
  status?: GameStatus;
  search?: string;
  providerCode?: string;
  limit?: number;
  offset?: number;
}

function buildQuery(f: AdminGamesFilters): string {
  const p = new URLSearchParams();
  if (f.category) p.set('category', f.category);
  if (f.status) p.set('status', f.status);
  if (f.search && f.search.trim()) p.set('search', f.search.trim());
  if (f.providerCode) p.set('providerCode', f.providerCode);
  if (f.limit !== undefined) p.set('limit', String(f.limit));
  if (f.offset !== undefined) p.set('offset', String(f.offset));
  const q = p.toString();
  return q ? `?${q}` : '';
}

export function useAdminGames(filters: AdminGamesFilters) {
  return useQuery<AdminGamesResponse>({
    queryKey: ['admin-games', filters],
    queryFn: () => apiGet(`/tenant/games${buildQuery(filters)}`),
    staleTime: 10_000,
  });
}

export interface UpdateGamePatch {
  isHidden?: boolean;
  isDisabled?: boolean;
  featured?: boolean;
  sortOrder?: number;
}

export function useUpdateGame() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateGamePatch }) =>
      apiPatch<AdminGame>(`/tenant/games/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-games'] }),
  });
}

export interface BulkGamesPatch {
  ids: string[];
  isHidden?: boolean;
  isDisabled?: boolean;
  featured?: boolean;
}

export function useBulkGames() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: BulkGamesPatch) =>
      apiPost<{ affected: number }>('/tenant/games/bulk', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-games'] }),
  });
}
