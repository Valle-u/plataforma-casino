/**
 * /play/lobby — Catálogo de Juegos.
 *
 * Pantalla "Juegos" del handoff: catálogo plano con controles de filtro.
 * El chrome (sidebar + header con buscador) lo provee play/layout.tsx.
 *
 * Composición (de arriba a abajo):
 *   1. Header: título "Juegos" + subtítulo (conteo) + control de orden
 *      (Populares / Nuevos / A-Z).
 *   2. Tabs de categoría: Todos + las categorías presentes (con conteo).
 *   3. Filtro de proveedor: Todos + proveedores presentes.
 *   4. Buscador (preserva la función del catálogo viejo).
 *   5. Grid de game cards (estilo Neón) con estado playable + links reales.
 *
 * Función PRESERVADA del catálogo anterior:
 *   - Datos: useActiveGames (GET /tenant/games/active).
 *   - isPlayable (por proveedor) → overlay "Próximamente" en no-jugables.
 *     OJO: es una lista blanca. Un proveedor nuevo que no se agregue acá
 *     sincroniza el catálogo bien pero sale entero como "Próximamente".
 *   - Link real al juego: /play/games/<code>/play/iframe.
 *   - Thumbnails + búsqueda client-side por nombre/código.
 *
 * Cambio de diseño: se removió el hero carousel + el strip de Destacados +
 * el agrupado por categoría (eso vive ahora en la home /play). Acá es un
 * catálogo plano filtrable, como pide el handoff.
 */

'use client';

import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useActiveGames,
  useGameFacets,
  type GameCategory,
  type PlayerGame,
} from '@/lib/hooks/use-games';
import { useAuth } from '@/lib/auth-context';
import { useIsDesktop } from '@/lib/hooks/use-is-desktop';
import { cn } from '@/lib/cn';
import { FilterChip } from '@/components/player/filter-chip';
import { GameSearch } from '@/components/player/game-search';
import { HomeGameCard } from '@/components/player/home-game-card';
import { StudioFilter } from '@/components/player/studio-filter';

// Lazy load: solo se descarga el bundle del modal en desktop.
// Mobile nunca carga este chunk.
const GameModal = dynamic(
  () => import('@/components/game-modal').then((m) => m.GameModal),
  { ssr: false },
);

type SortKey = 'pop' | 'new' | 'az';

const PAGE_SIZE = 30;

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'pop', label: 'Populares' },
  { id: 'new', label: 'Nuevos' },
  { id: 'az', label: 'A-Z' },
];

/** category → label + color de acento. Las 5 categorías que soporta el backend;
 *  en la UI solo aparecen las que tienen juegos (conteo real vía facets). */
const CATEGORY_META: Record<GameCategory, { label: string; accent: string }> = {
  slots: { label: 'Slots', accent: 'var(--color-accent)' },
  live: { label: 'En Vivo', accent: 'var(--color-magenta)' },
  crash: { label: 'Crash', accent: 'var(--color-success)' },
  table: { label: 'Mesa', accent: '#5b8def' },
  mini: { label: 'Mini', accent: '#f0a020' },
};

/** Orden de visualización de las categorías. Cuáles se muestran es dinámico
 *  (las que tengan juegos según `/tenant/games/facets`). */
const CATEGORY_DISPLAY_ORDER: GameCategory[] = [
  'slots',
  'live',
  'crash',
  'table',
  'mini',
];
const KNOWN_CATEGORIES = new Set<string>(CATEGORY_DISPLAY_ORDER);

/**
 * Las pestañas del lobby: "Todos", "Destacados" y las categorías reales.
 *
 * `featured` no es una categoría del backend — es un filtro — pero vive al
 * lado de las categorías porque para el jugador es una sección más, no una
 * forma de ordenar. Antes pesaba dentro del orden "Populares", que terminaba
 * significando dos cosas a la vez.
 */
type LobbyTab = 'all' | 'featured' | GameCategory;

/** Sentinela del chip "Otros" (agrupa los juegos cuyo proveedor no informa
 *  oficial). Nunca choca con ids reales de Palace (positivos). */
const OTHERS_STUDIO = '__otros__';

function isPlayable(game: PlayerGame): boolean {
  // Palace: requiere provider_id + game_symbol para construir el launch URL.
  if (game.providerCode === 'palace') {
    return (
      game.palaceProviderId != null &&
      game.palaceGameSymbol != null &&
      game.palaceGameSymbol.length > 0
    );
  }
  // Forever: el sync garantiza config.forever; el launch (GetGameUrl) lo arma.
  if (game.providerCode === 'forever') return true;
  // Gregmorn: el launch (openGame) manda el gameId CRUDO que el sync guardó en
  // config.gregmorn.gameId — no el games.code, que va sanitizado. Sin ese dato
  // el juego no abre, así que se chequea en vez de asumir que está.
  if (game.providerCode === 'gregmorn') {
    const cfg = game.config as { gregmorn?: { gameId?: unknown } } | null;
    const gameId = cfg?.gregmorn?.gameId;
    return typeof gameId === 'string' && gameId.length > 0;
  }
  return false;
}

function GameLobbyContent() {
  const [tab, setTab] = useState<LobbyTab>('all');
  const [studio, setStudio] = useState<string>('all');
  const [sort, setSort] = useState<SortKey>('pop');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [selectedGame, setSelectedGame] = useState<string | null>(null);
  const isDesktop = useIsDesktop();
  const { user, openLoginModal } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const categoryParam = searchParams.get('category');
  const queryParam = searchParams.get('q');

  // Las categorías de la home (/play) apuntan a este lobby con ?category=slots|
  // crash|live|table|mini. Sincronizamos el tab con la URL de forma reactiva
  // (funciona también cuando la página ya está montada y solo cambia el param).
  // Se valida contra KNOWN_CATEGORIES; valores desconocidos caen a "Todos". Si
  // la categoría no tiene juegos, su tab no aparece y el grid queda vacío.
  useEffect(() => {
    if (categoryParam === 'featured') {
      setTab('featured');
    } else if (categoryParam && KNOWN_CATEGORIES.has(categoryParam)) {
      setTab(categoryParam as GameCategory);
    } else {
      setTab('all');
    }
  }, [categoryParam]);

  // Buscador global del header (/play/lobby?q=<término>): siembra el buscador
  // del lobby con el término y resetea la paginación. Reactivo: si el header
  // vuelve a buscar mientras el lobby ya está montado, se re-aplica.
  useEffect(() => {
    if (queryParam !== null) {
      setSearch(queryParam);
      setPage(0);
    }
  }, [queryParam]);

  // Deep-link desde la home (/play/lobby?studio=Pragmatic). Ahora viaja el
  // NOMBRE del estudio y no el provider_id de Palace: sirve para los tres
  // proveedores y el link se lee.
  const studioParam = searchParams.get('studio');
  useEffect(() => {
    if (studioParam) {
      setStudio(studioParam);
      setPage(0);
    }
  }, [studioParam]);

  const offset = page * PAGE_SIZE;
  const searchDebounced = search.trim();


  // Conteos reales (una sola pasada en el backend, ver /tenant/games/facets):
  //  - global → cuántos juegos tiene cada categoría (para los tabs).
  //  - acotado a la categoría elegida → estudios presentes en esa categoría.
  const globalFacets = useGameFacets();
  const studioFacets = useGameFacets(
    tab !== 'all' && tab !== 'featured' ? tab : undefined,
  );

  // Categorías a mostrar: solo las que tienen juegos, en el orden de display.
  const catCounts = useMemo(() => {
    const m = new Map<GameCategory, number>();
    for (const c of globalFacets.data?.categories ?? []) m.set(c.category, c.count);
    return m;
  }, [globalFacets.data]);
  const availableCategories = useMemo(
    () => CATEGORY_DISPLAY_ORDER.filter((c) => (catCounts.get(c) ?? 0) > 0),
    [catCounts],
  );

  // Estudios presentes en la categoría actual, con conteo real. El backend ya
  // los devuelve canonizados y unificados entre proveedores (games.studio,
  // migración 0107) — antes esto resolvía el provider_id de Palace contra un
  // mapa de nombres y los juegos de Gregmorn y Forever quedaban todos en
  // "Otros".
  const studios = useMemo(() => {
    const raw = studioFacets.data?.studios ?? [];
    const named: { id: string; name: string; count: number }[] = [];
    let othersCount = 0;
    for (const s of raw) {
      const name = s.studio?.trim();
      if (name) named.push({ id: name, name, count: s.count });
      else othersCount += s.count;
    }
    named.sort((a, b) => b.count - a.count);
    if (named.length > 0 && othersCount > 0) {
      named.push({ id: OTHERS_STUDIO, name: 'Otros', count: othersCount });
    }
    return named;
  }, [studioFacets.data]);

  // "Otros" solo existe si hay juegos sin estudio en la categoría actual.
  const isOthers =
    studio === OTHERS_STUDIO && studios.some((p) => p.id === OTHERS_STUDIO);

  const query = useActiveGames({
    category: tab !== 'all' && tab !== 'featured' ? tab : undefined,
    featuredOnly: tab === 'featured' ? true : undefined,
    studio: studio !== 'all' && !isOthers ? studio : undefined,
    studioNone: isOthers ? true : undefined,
    search: searchDebounced || undefined,
    limit: PAGE_SIZE,
    offset,
  });

  const games = query.data?.data ?? [];
  const total = query.data?.total ?? 0;
  const hasMore = query.data?.hasMore ?? false;

  // Filtrado client-side solo por sort sobre la página actual (provider ya es server-side).
  const filtered = useMemo(() => {
    const list = games.slice();
    // Orden
    if (sort === 'az') {
      list.sort((a, b) => a.name.localeCompare(b.name, 'es'));
    } else if (sort === 'new') {
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } else {
      // Populares (el orden POR DEFECTO): destacados primero y después el
      // orden curado del catálogo. Espeja lo que hace el backend, si no la
      // página llegaba con los destacados adelante y este sort los volvía a
      // enterrar.
      //
      // Que pesen acá y NO en "Nuevos" ni "A-Z" es a propósito: cuando el
      // jugador elige un criterio explícito, se le respeta; cuando no eligió
      // nada, mandan los destacados.
      list.sort((a, b) => {
        if (a.featured !== b.featured) return a.featured ? -1 : 1;
        return a.sortOrder - b.sortOrder;
      });
    }
    return list;
  }, [games, sort]);

  const subtitle = useMemo(() => {
    if (query.isLoading) return 'Cargando catálogo…';
    if (query.isError) return 'No se pudo cargar el catálogo.';
    if (total === 0) return searchDebounced ? `No encontramos "${searchDebounced}".` : 'No hay juegos.';
    const start = offset + 1;
    const end = Math.min(offset + PAGE_SIZE, total);
    return `${start}–${end} de ${total} juegos`;
  }, [query.isLoading, query.isError, total, offset, searchDebounced]);

  // Resetear página al cambiar filtros.
  const handleTabChange = (newTab: LobbyTab) => {
    setTab(newTab);
    setPage(0);
    setStudio('all');
    setSearch('');
    // Mantener la URL sincronizada con el tab (refrescar/back no pierden el filtro).
    const params = new URLSearchParams(searchParams.toString());
    // Cambiar de categoría descarta el deep-link de estudio y la búsqueda.
    params.delete('studio');
    params.delete('q');
    if (newTab === 'all') params.delete('category');
    else params.set('category', newTab);
    const qs = params.toString();
    router.replace(qs ? `/play/lobby?${qs}` : '/play/lobby', { scroll: false });
  };

  const handleStudioChange = (next: string) => {
    setStudio(next);
    setPage(0);
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(0);
  };

  const handleGameClick = useCallback((code: string) => {
    if (!user) {
      openLoginModal(`/play/games/${code}/play/iframe`);
      return;
    }
    if (isDesktop) {
      setSelectedGame(code);
    }
  }, [isDesktop, user, openLoginModal]);

  return (
    <div className="flex flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      {/* 1) Header: título + subtítulo + orden */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-[34px] leading-none">Juegos</h1>
          <p className="text-[13px] text-[var(--color-fg-muted)]">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-subtle)]">
            Ordenar
          </span>
          <div className="flex items-center gap-1">
            {SORTS.map((s) => {
              const active = sort === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSort(s.id)}
                  className={cn(
                    'h-8 rounded-[var(--radius-sm)] px-3 text-[12px] font-medium transition-colors',
                    active
                      ? 'text-[var(--color-accent-fg)]'
                      : 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]',
                  )}
                  style={
                    active ? { background: 'var(--gradient-accent)' } : undefined
                  }
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* 2) Tabs de categoría */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterChip
          label="Todos"
          count={total}
          active={tab === 'all'}
          onClick={() => handleTabChange('all')}
        />
        {/* Destacados: solo si hay alguno marcado. Una pestaña que lleva a una
            grilla vacía es peor que no tenerla. */}
        {(globalFacets.data?.featured ?? 0) > 0 && (
          <FilterChip
            label="Destacados"
            count={globalFacets.data?.featured}
            active={tab === 'featured'}
            onClick={() => handleTabChange('featured')}
          />
        )}
        {availableCategories.map((c) => (
          <FilterChip
            key={c}
            label={CATEGORY_META[c].label}
            count={catCounts.get(c)}
            active={tab === c}
            onClick={() => handleTabChange(c)}
          />
        ))}
      </div>

      {/* 3) Filtro por estudio — de los TRES proveedores. Con 46 estudios la
             fila de chips era una pared que empujaba el grid abajo del fold, y
             en celular ocupaba media pantalla: el componente muestra los más
             jugados y manda el resto a un buscador. Ver StudioFilter. */}
      <StudioFilter
        studios={studios}
        value={studio}
        onChange={handleStudioChange}
      />

      {/* 4) Buscador (preserva la función del catálogo) */}
      <GameSearch
        value={search}
        onChange={handleSearchChange}
        // Acá la búsqueda también mira el estudio (games.studio), así que el
        // texto lo dice: si no, nadie prueba escribir "Pragmatic".
        placeholder="Escribí el nombre del juego o del estudio"
      />

      {/* 5) Grid */}
      {query.isLoading ? (
        <LoadingGrid />
      ) : query.isError ? (
        <EmptyState
          label="Ups, no pudimos cargar los juegos."
          description="Esperá unos segundos y probá de nuevo."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          label={
            search.trim()
              ? `No encontramos juegos para "${search}".`
              : 'Todavía no hay juegos en esta categoría.'
          }
          description={
            search.trim()
              ? 'Probá con otro nombre o buscá en otra categoría.'
              : 'Volvé pronto: estamos sumando juegos todo el tiempo.'
          }
        />
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {filtered.map((g) => (
              <li key={g.id}>
                <HomeGameCard
                  game={g}
                  unavailable={!isPlayable(g)}
                  onPlay={handleGameClick}
                  isDesktop={isDesktop}
                />
              </li>
            ))}
          </ul>

          {/* Paginación */}
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-end gap-3 text-[11px] text-[var(--color-fg-subtle)]">
              <span className="font-mono tabular-nums">
                {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} de {total}
              </span>
              <div className="flex items-center gap-px bg-[var(--color-border)]">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-3 h-11 lg:h-7 text-[11px] uppercase tracking-[0.08em] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]"
                >
                  Anterior
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!hasMore}
                  className="px-3 h-11 lg:h-7 text-[11px] uppercase tracking-[0.08em] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]"
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Desktop: game modal */}
      {isDesktop && (
        <GameModal
          gameCode={selectedGame ?? ''}
          open={!!selectedGame}
          onOpenChange={(open) => {
            if (!open) setSelectedGame(null);
          }}
        />
      )}
    </div>
  );
}

// useSearchParams necesita estar dentro de un Suspense boundary para no
// romper el prerender estático de la página.
export default function PlayGamesPage() {
  return (
    <Suspense fallback={null}>
      <GameLobbyContent />
    </Suspense>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Controles
// ──────────────────────────────────────────────────────────────────────




// ──────────────────────────────────────────────────────────────────────
// Game card (estilo Neón) — preserva playable + link real + thumbnail
// ──────────────────────────────────────────────────────────────────────


function LoadingGrid() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {Array.from({ length: 10 }).map((_, i) => (
        <Skeleton
          key={i}
          className="w-full rounded-[var(--radius-lg)] bg-[var(--color-bg-subtle)] aspect-[4/5]"
        />
      ))}
    </div>
  );
}
