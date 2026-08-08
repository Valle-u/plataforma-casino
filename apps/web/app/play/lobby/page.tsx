/**
 * /play/lobby — Catálogo de Juegos (rediseño "Neón Milonga", Casino TANGO).
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
 *   - isPlayable (palace) → overlay "Próximamente" en no-jugables.
 *   - Link real al juego: /play/games/<code>/play/iframe.
 *   - Thumbnails + búsqueda client-side por nombre/código.
 *
 * Cambio de diseño: se removió el hero carousel + el strip de Destacados +
 * el agrupado por categoría (eso vive ahora en la home /play). Acá es un
 * catálogo plano filtrable, como pide el handoff.
 */

'use client';

import { Lock, Play, Search, X } from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useActiveGames,
  useGameProviders,
  type GameCategory,
  type PlayerGame,
} from '@/lib/hooks/use-games';
import { useAuth } from '@/lib/auth-context';
import { useIsDesktop } from '@/lib/hooks/use-is-desktop';
import { cn } from '@/lib/cn';

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

/** category → label + color de acento (paleta Neón Milonga). */
const CATEGORY_META: Partial<Record<GameCategory, { label: string; accent: string }>> = {
  slots: { label: 'Slots', accent: 'var(--color-accent)' },
  crash: { label: 'Crash', accent: 'var(--color-success)' },
  live: { label: 'En Vivo', accent: 'var(--color-magenta)' },
};

/**
 * Orden fijo para los tabs de categoría. Sprint 58: "live" queda fuera por
 * ahora (no hay juegos en vivo); se re-activa cuando haya catálogo live.
 */
const CATEGORY_ORDER: GameCategory[] = ['slots', 'crash'];

/** Sprint 57: id sentinel del chip "Otros" (agrupa proveedores sin nombre
 *  oficial). Nunca choca con ids reales de Palace (positivos). */
const OTHERS_PROVIDER = -1;

function isPlayable(game: PlayerGame): boolean {
  // Palace es el único provider real. Requerimos provider_id y game_symbol
  // para poder construir el launch URL; sin esos, el juego no es jugable.
  return (
    game.providerCode === 'palace' &&
    game.palaceProviderId != null &&
    game.palaceGameSymbol != null &&
    game.palaceGameSymbol.length > 0
  );
}

/** Conteo decorativo de "jugando" — determinístico por índice (no hay
 *  feed real de jugadores online; el handoff lo trata como dato de feed). */
function playersFor(i: number): number {
  return 120 + ((i * 173) % 820);
}

function GameLobbyContent() {
  const [tab, setTab] = useState<'all' | GameCategory>('all');
  const [providerId, setProviderId] = useState<number | 'all'>('all');
  const [sort, setSort] = useState<SortKey>('pop');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [selectedGame, setSelectedGame] = useState<string | null>(null);
  const isDesktop = useIsDesktop();
  const { user, openLoginModal } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const categoryParam = searchParams.get('category');

  // Sprint 58: las categorías de la home (/play) apuntan a este lobby con
  // ?category=slots|crash. Sincronizamos el tab con la URL de forma reactiva
  // (funciona también cuando la página ya está montada y solo cambia el param).
  // Se valida contra CATEGORY_ORDER: valores desconocidos (ej. "live" mientras
  // no haya juegos en vivo) caen a "Todos".
  useEffect(() => {
    if (categoryParam && (CATEGORY_ORDER as string[]).includes(categoryParam)) {
      setTab(categoryParam as GameCategory);
    } else {
      setTab('all');
    }
  }, [categoryParam]);

  const offset = page * PAGE_SIZE;
  const searchDebounced = search.trim();

  const providerNames = useGameProviders();
  const nameMap = providerNames.data?.providers ?? {};

  // Query SIN filtro de provider para obtener la lista estable de proveedores.
  const allQuery = useActiveGames({
    category: tab !== 'all' ? tab : undefined,
    search: searchDebounced || undefined,
    limit: 200,
  });

  // Proveedores presentes en TODOS los juegos (sin filtro provider), siempre visibles.
  // Sprint 57: con nombre oficial → chip individual; sin nombre → un único
  // chip "Otros" (el backend los filtra con providerNoName).
  const providers = useMemo(() => {
    const allGames = allQuery.data?.data ?? [];
    const named = new Map<number, string>();
    const unnamed = new Set<number>();
    for (const g of allGames) {
      if (!g.palaceProviderId) continue;
      const name = nameMap[g.palaceProviderId];
      if (name && name.trim()) {
        if (!named.has(g.palaceProviderId)) named.set(g.palaceProviderId, name);
      } else {
        unnamed.add(g.palaceProviderId);
      }
    }
    const list = Array.from(named.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
    if (unnamed.size > 0) list.push({ id: OTHERS_PROVIDER, name: 'Otros' });
    return list;
  }, [allQuery.data, nameMap]);

  // "Otros" solo existe si hay proveedores sin nombre en el catálogo.
  const isOthers = providerId === OTHERS_PROVIDER && providers.some((p) => p.id === OTHERS_PROVIDER);

  const query = useActiveGames({
    category: tab !== 'all' ? tab : undefined,
    providerId: providerId !== 'all' && !isOthers ? providerId : undefined,
    providerNoName: isOthers ? true : undefined,
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
      // Populares: destacados primero, luego por sortOrder.
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
  const handleTabChange = (newTab: 'all' | GameCategory) => {
    setTab(newTab);
    setPage(0);
    setProviderId('all');
    setSearch('');
    // Mantener la URL sincronizada con el tab (refrescar/back no pierden el filtro).
    const params = new URLSearchParams(searchParams.toString());
    if (newTab === 'all') params.delete('category');
    else params.set('category', newTab);
    const qs = params.toString();
    router.replace(qs ? `/play/lobby?${qs}` : '/play/lobby', { scroll: false });
  };

  const handleProviderChange = (newProviderId: number | 'all') => {
    setProviderId(newProviderId);
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
        <CategoryTab
          label="Todos"
          count={total}
          active={tab === 'all'}
          onClick={() => handleTabChange('all')}
        />
        {CATEGORY_ORDER.map((c) => (
          <CategoryTab
            key={c}
            label={CATEGORY_META[c]?.label ?? c}
            active={tab === c}
            onClick={() => handleTabChange(c)}
          />
        ))}
      </div>

      {/* 3) Filtro de proveedor — siempre visible */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-subtle)]">
          Proveedor
        </span>
        <ProviderChip
          label="Todos"
          active={providerId === 'all'}
          onClick={() => handleProviderChange('all')}
        />
        {providers.map((p) => (
          <ProviderChip
            key={p.id}
            label={p.name}
            active={providerId === p.id}
            onClick={() => handleProviderChange(p.id)}
          />
        ))}
      </div>

      {/* 4) Buscador (preserva la función del catálogo) */}
      <SearchBar value={search} onChange={handleSearchChange} />

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
            {filtered.map((g, i) => (
              <li key={g.id}>
                <GameCard game={g} players={playersFor(offset + i)} onPlay={handleGameClick} isDesktop={isDesktop} />
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
                  className="px-3 h-7 text-[11px] uppercase tracking-[0.08em] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]"
                >
                  Anterior
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!hasMore}
                  className="px-3 h-7 text-[11px] uppercase tracking-[0.08em] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]"
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

function CategoryTab({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]',
        active
          ? 'text-[var(--color-accent-fg)]'
          : 'border border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] hover:border-[var(--color-accent-border)] hover:text-[var(--color-fg)]',
      )}
      style={active ? { background: 'var(--gradient-accent)' } : undefined}
    >
      {label}
      {count !== undefined && (
        <span
          className={cn(
            'text-[11px] tabular-nums',
            active ? 'opacity-80' : 'text-[var(--color-fg-subtle)]',
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function ProviderChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'h-8 rounded-[var(--radius-sm)] px-3 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]',
        active
          ? 'bg-[rgba(255,46,160,.12)] text-[var(--color-fg)] ring-1 ring-inset ring-[var(--color-accent-border)]'
          : 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]',
      )}
    >
      {label}
    </button>
  );
}

function SearchBar({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <label className="flex h-11 items-center gap-3 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3.5 transition-colors focus-within:border-[var(--color-accent-border)] focus-within:ring-2 focus-within:ring-[var(--color-accent)] focus-within:ring-offset-2 focus-within:ring-offset-[var(--color-bg)]">
      <Search className="size-4 shrink-0 text-[var(--color-fg-subtle)]" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Buscar juegos, proveedores…"
        aria-label="Buscar juegos"
        className="w-full min-w-0 bg-transparent text-[14px] text-[var(--color-fg)] outline-none placeholder:text-[var(--color-fg-subtle)] [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Limpiar búsqueda"
          className="grid size-7 shrink-0 place-items-center rounded-full text-[var(--color-fg-subtle)] transition-colors hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]"
        >
          <X className="size-3.5" />
        </button>
      )}
    </label>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Game card (estilo Neón) — preserva playable + link real + thumbnail
// ──────────────────────────────────────────────────────────────────────

function GameCard({ game, players, onPlay, isDesktop }: { game: PlayerGame; players: number; onPlay?: (code: string) => void; isDesktop?: boolean }) {
  const playable = isPlayable(game);
  const meta = CATEGORY_META[game.category] ?? { label: game.category, accent: 'var(--color-fg-muted)' };
  const catColor = game.category === 'slots' ? '#FFD700' : game.category === 'crash' ? '#FF6B35' : game.category === 'live' ? '#C53030' : '#888';

  const art = (
    <div
      className={cn(
        'relative aspect-[4/3] w-full overflow-hidden rounded-[var(--radius-lg)]',
        'border border-[var(--color-border)] bg-[var(--color-bg-elevated)] transition-all duration-300',
        playable &&
          'group-hover:-translate-y-1.5 group-hover:border-[var(--card-accent)] group-hover:shadow-[0_16px_44px_-12px_var(--card-glow)]',
      )}
    >
      {/* Arte: thumbnail real o gradiente neón por categoría. Fondo oscuro +
          object-contain: todas las thumbs (aspectos distintos por proveedor)
          se ven completas y con el mismo encuadre, sin recortes. */}
      {game.thumbnailUrl ? (

        <img
          src={game.thumbnailUrl}
          alt={game.name}
          className={cn(
            'h-full w-full object-contain transition-transform duration-300',
            playable ? 'group-hover:scale-105' : 'opacity-50 grayscale-[60%]',
          )}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        <div
          className="h-full w-full"
          style={{
            background: `linear-gradient(150deg, color-mix(in srgb, ${catColor} 55%, #0a0008) 0%, #12061a 70%)`,
          }}
        />
      )}

      {/* Badge de categoría estilo home */}
      <span
        className="absolute left-2 top-2 px-2.5 h-7 inline-flex items-center text-[12px] font-medium rounded-full"
        style={{
          background: `${catColor}e6`,
          color: '#fff',
        }}
      >
        {meta.label}
      </span>

      {/* Badge HOT (arriba-derecha) para destacados jugables */}
      {game.featured && playable && (
        <span
          className="absolute right-2 top-2 inline-flex h-5 items-center rounded-[var(--radius-sm)] px-2 text-[9px] font-bold uppercase tracking-[0.12em] text-white"
          style={{ background: 'var(--color-magenta)' }}
        >
          Hot
        </span>
      )}

      {/* Badge "Próximamente" para no jugables */}
      {!playable && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-[rgba(4,6,14,.65)] backdrop-blur-[1px]">
          <Lock className="size-4 text-[var(--color-fg-muted)]" />
          <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg)]">
            Próximamente
          </span>
        </div>
      )}

      {/* Play overlay on hover (solo jugables) */}
      {playable && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-all duration-300">
          <div className="size-12 rounded-full bg-white/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 scale-75 group-hover:scale-100 shadow-lg">
            <Play className="size-6 text-black ml-0.5" fill="currentColor" />
          </div>
        </div>
      )}
    </div>
  );

  const caption = (
    <div className="flex flex-col gap-0.5 px-0.5">
      <h3 className="font-display truncate text-[14px] leading-tight text-[var(--color-fg)]">
        {game.name}
      </h3>
      <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-fg-subtle)]">
        <span className="truncate">{game.providerCode}</span>
        {playable && (
          <>
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{
                background: 'var(--color-success)',
                boxShadow: '0 0 6px var(--color-success)',
              }}
            />
            <span className="tabular-nums">{players} jugando</span>
          </>
        )}
      </div>
    </div>
  );

  if (!playable) {
    return (
      <div
        aria-disabled="true"
        aria-label={`${game.name} — próximamente`}
        className="flex cursor-not-allowed select-none flex-col gap-2"
      >
        {art}
        {caption}
      </div>
    );
  }

  // Desktop: open modal on click. Mobile: navigate via Link.
  if (isDesktop) {
    return (
      <button
        type="button"
        onClick={() => onPlay?.(game.code)}
        className="group flex flex-col gap-2 rounded-[var(--radius-lg)] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]"
        aria-label={`Jugar ${game.name} — ${meta.label}`}
        style={{
          '--card-accent': catColor,
          '--card-glow': `${catColor}80`,
        } as React.CSSProperties}
      >
        {art}
        {caption}
      </button>
    );
  }

  return (
    <Link
      href={`/play/games/${game.code}/play/iframe`}
      className="group flex flex-col gap-2 rounded-[var(--radius-lg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]"
      aria-label={`Jugar ${game.name} — ${meta.label}`}
      style={{
        '--card-accent': catColor,
        '--card-glow': `${catColor}80`,
      } as React.CSSProperties}
    >
      {art}
      {caption}
    </Link>
  );
}

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
