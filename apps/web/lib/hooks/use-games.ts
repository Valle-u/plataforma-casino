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

export type GameCategory = 'slots' | 'live' | 'crash' | 'table' | 'mini';

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
  palaceProviderId: number | null;
  palaceGameSymbol: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ListResponse {
  data: PlayerGame[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface ListGamesFilters {
  category?: GameCategory;
  /** Nombre del estudio ya canonizado (games.studio). Sirve para los tres
   *  proveedores; antes esto era el provider_id de Palace y solo filtraba
   *  los juegos de Palace. */
  studio?: string;
  /** true → solo juegos SIN estudio conocido (el chip "Otros"). */
  studioNone?: boolean;
  /** Filtro por adapter (provider_code): 'palace' | 'forever'. Lobby multi-proveedor. */
  providerCode?: string;
  featuredOnly?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

function buildQuery(f: ListGamesFilters): string {
  const params = new URLSearchParams();
  if (f.category) params.set('category', f.category);
  if (f.studio !== undefined) params.set('studio', f.studio);
  if (f.studioNone) params.set('studioNone', 'true');
  if (f.providerCode) params.set('providerCode', f.providerCode);
  if (f.featuredOnly) params.set('featuredOnly', 'true');
  if (f.search) params.set('search', f.search);
  if (f.limit !== undefined) params.set('limit', String(f.limit));
  if (f.offset !== undefined) params.set('offset', String(f.offset));
  const q = params.toString();
  return q ? `?${q}` : '';
}

/**
 * Sprint 52.1 — Recent public wins feed (real, reemplaza mock del
 * LiveWinsTicker). El backend devuelve usernames anonimizados.
 */
export interface RecentPublicWin {
  id: string;
  username: string;
  amount: string;
  gameName: string;
  gameCategory: GameCategory;
  settledAt: string;
}

interface RecentWinsResponse {
  data: RecentPublicWin[];
}

/**
 * `useRecentPublicWins` — poll cada 15s para mantener el feed "live".
 * Pausa background (no spammeo cuando tab oculto).
 *
 * Refetch on focus también — cuando el user vuelve al tab, ve novedades.
 */
export function useRecentPublicWins(limit = 10) {
  return useQuery({
    queryKey: ['recent-public-wins', limit],
    queryFn: () =>
      apiGet<RecentWinsResponse>(`/tenant/games/recent-wins?limit=${limit}`),
    staleTime: 10_000,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

export function useActiveGames(
  filters: ListGamesFilters = {},
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ['active-games', filters],
    enabled: options?.enabled ?? true,
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
      return apiGet<PlayerGame>(`/tenant/games/code/${encodeURIComponent(code)}`);
    },
    enabled: !!code,
    staleTime: 60_000,
  });
}

interface ProvidersResponse {
  providers: Record<number, string>;
}

export function useGameProviders() {
  return useQuery({
    queryKey: ['game-providers'],
    queryFn: () => apiGet<ProvidersResponse>('/tenant/games/providers'),
    staleTime: Infinity,
  });
}

/**
 * Conteos reales por categoría y por estudio (Palace provider_id). Reemplaza
 * los números hardcodeados del lobby/home. Ver `GET /tenant/games/facets`.
 */
export interface GameFacets {
  total: number;
  categories: { category: GameCategory; count: number }[];
  /** Estudio ya canonizado. `null` = el proveedor no lo informa (chip "Otros"). */
  studios: { studio: string | null; count: number }[];
  /** Cuántos destacados hay. 0 → el lobby no muestra la pestaña. */
  featured: number;
}

/**
 * @param category si se pasa, los conteos de `studios` se acotan a esa
 *   categoría (para el filtro de estudios del lobby cuando hay una categoría
 *   elegida). Sin `category` → conteos globales (tabs de categoría + home).
 */
export function useGameFacets(category?: GameCategory) {
  return useQuery({
    queryKey: ['game-facets', category ?? null],
    queryFn: () =>
      apiGet<GameFacets>(
        `/tenant/games/facets${category ? `?category=${category}` : ''}`,
      ),
    staleTime: 60_000,
  });
}
