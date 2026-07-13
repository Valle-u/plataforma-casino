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
 *   - isPlayable (mock_*) → overlay "Próximamente" en no-jugables.
 *   - Link real al juego: /play/games/<code>/play/iframe.
 *   - Thumbnails + búsqueda client-side por nombre/código.
 *
 * Cambio de diseño: se removió el hero carousel + el strip de Destacados +
 * el agrupado por categoría (eso vive ahora en la home /play). Acá es un
 * catálogo plano filtrable, como pide el handoff.
 */

'use client';

import { Lock, Search, X } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useActiveGames,
  type GameCategory,
  type PlayerGame,
} from '@/lib/hooks/use-games';
import { cn } from '@/lib/cn';

type SortKey = 'pop' | 'new' | 'az';

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'pop', label: 'Populares' },
  { id: 'new', label: 'Nuevos' },
  { id: 'az', label: 'A-Z' },
];

/** category → label + color de acento (paleta Neón Milonga). */
const CATEGORY_META: Record<GameCategory, { label: string; accent: string }> = {
  slots: { label: 'Slots', accent: 'var(--color-accent)' },
  crash: { label: 'Crash', accent: 'var(--color-success)' },
  table: { label: 'Mesa', accent: 'var(--color-purple)' },
  live: { label: 'En Vivo', accent: 'var(--color-magenta)' },
};

/** Orden fijo para los tabs de categoría. */
const CATEGORY_ORDER: GameCategory[] = ['slots', 'crash', 'table', 'live'];

function isPlayable(game: PlayerGame): boolean {
  // Juegos con provider registrado (mock, palace) son jugables.
  return game.providerCode === 'mock' || game.providerCode === 'palace';
}

/** Conteo decorativo de "jugando" — determinístico por índice (no hay
 *  feed real de jugadores online; el handoff lo trata como dato de feed). */
function playersFor(i: number): number {
  return 120 + ((i * 173) % 820);
}

export default function PlayGamesPage() {
  const query = useActiveGames();
  const games = query.data?.data ?? [];

  const [tab, setTab] = useState<'all' | GameCategory>('all');
  const [provider, setProvider] = useState<string>('all');
  const [sort, setSort] = useState<SortKey>('pop');
  const [search, setSearch] = useState('');

  // Categorías presentes en el catálogo (para los tabs) + conteos.
  const categoryCounts = useMemo(() => {
    const map = new Map<GameCategory, number>();
    for (const g of games) map.set(g.category, (map.get(g.category) ?? 0) + 1);
    return map;
  }, [games]);

  const presentCategories = useMemo(
    () => CATEGORY_ORDER.filter((c) => categoryCounts.has(c)),
    [categoryCounts],
  );

  // Proveedores presentes (para el filtro).
  const providers = useMemo(() => {
    const set = new Set<string>();
    for (const g of games) if (g.providerCode) set.add(g.providerCode);
    return Array.from(set).sort();
  }, [games]);

  const searchNorm = search.trim().toLowerCase();

  const filtered = useMemo(() => {
    let list = games.slice();
    if (tab !== 'all') list = list.filter((g) => g.category === tab);
    if (provider !== 'all') list = list.filter((g) => g.providerCode === provider);
    if (searchNorm) {
      list = list.filter(
        (g) =>
          g.name.toLowerCase().includes(searchNorm) ||
          g.code.toLowerCase().includes(searchNorm) ||
          g.providerCode.toLowerCase().includes(searchNorm),
      );
    }
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
  }, [games, tab, provider, searchNorm, sort]);

  const subtitle = useMemo(() => {
    if (query.isLoading) return 'Cargando catálogo…';
    if (query.isError) return 'No se pudo cargar el catálogo.';
    const shown = presentCategories.slice(0, 3).map((c) => CATEGORY_META[c].label);
    const cats =
      shown.length === 0
        ? ''
        : shown.length === 1
          ? ` · ${shown[0]}`
          : ` · ${shown.slice(0, -1).join(', ')} y ${shown[shown.length - 1]}`;
    return `${games.length} ${games.length === 1 ? 'juego' : 'juegos'}${cats}`;
  }, [query.isLoading, query.isError, presentCategories, games.length]);

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
          count={games.length}
          active={tab === 'all'}
          onClick={() => setTab('all')}
        />
        {presentCategories.map((c) => (
          <CategoryTab
            key={c}
            label={CATEGORY_META[c].label}
            count={categoryCounts.get(c) ?? 0}
            active={tab === c}
            onClick={() => setTab(c)}
          />
        ))}
      </div>

      {/* 3) Filtro de proveedor (solo si hay más de uno) */}
      {providers.length > 1 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-subtle)]">
            Proveedor
          </span>
          <ProviderChip
            label="Todos"
            active={provider === 'all'}
            onClick={() => setProvider('all')}
          />
          {providers.map((p) => (
            <ProviderChip
              key={p}
              label={p}
              active={provider === p}
              onClick={() => setProvider(p)}
            />
          ))}
        </div>
      )}

      {/* 4) Buscador (preserva la función del catálogo) */}
      <SearchBar value={search} onChange={setSearch} />

      {/* 5) Grid */}
      {query.isLoading ? (
        <LoadingGrid />
      ) : query.isError ? (
        <EmptyState hint="games" label="No se pudo cargar el catálogo." />
      ) : filtered.length === 0 ? (
        <EmptyState
          hint="games"
          label={
            searchNorm
              ? `No encontramos juegos para "${search}".`
              : 'No hay juegos en este filtro.'
          }
        />
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {filtered.map((g, i) => (
            <li key={g.id}>
              <GameCard game={g} players={playersFor(i)} />
            </li>
          ))}
        </ul>
      )}
    </div>
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
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-medium transition-colors',
        active
          ? 'text-[var(--color-accent-fg)]'
          : 'border border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] hover:border-[var(--color-accent-border)] hover:text-[var(--color-fg)]',
      )}
      style={active ? { background: 'var(--gradient-accent)' } : undefined}
    >
      {label}
      <span
        className={cn(
          'text-[11px] tabular-nums',
          active ? 'opacity-80' : 'text-[var(--color-fg-subtle)]',
        )}
      >
        {count}
      </span>
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
        'h-8 rounded-[var(--radius-sm)] px-3 text-[12px] transition-colors',
        active
          ? 'bg-[rgba(46,155,255,.12)] text-[var(--color-fg)] ring-1 ring-inset ring-[var(--color-accent-border)]'
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
    <label className="flex h-11 items-center gap-3 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3.5 transition-colors focus-within:border-[var(--color-accent-border)]">
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
          className="grid size-7 shrink-0 place-items-center rounded-full text-[var(--color-fg-subtle)] transition-colors hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]"
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

function GameCard({ game, players }: { game: PlayerGame; players: number }) {
  const playable = isPlayable(game);
  const meta = CATEGORY_META[game.category] ?? CATEGORY_META.slots;

  const art = (
    <div
      className={cn(
        'relative aspect-[4/5] w-full overflow-hidden rounded-[var(--radius-lg)]',
        'border border-[var(--color-border)] transition-all duration-300',
        playable &&
          'group-hover:-translate-y-1.5 group-hover:border-[var(--color-accent-border)] group-hover:shadow-[0_16px_44px_-12px_var(--color-accent-glow)]',
      )}
    >
      {/* Arte: thumbnail real o gradiente neón por categoría */}
      {game.thumbnailUrl ? (

        <img
          src={game.thumbnailUrl}
          alt={game.name}
          className={cn(
            'h-full w-full object-cover transition-transform duration-300',
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
            background: `linear-gradient(150deg, color-mix(in srgb, ${meta.accent} 55%, #04060e) 0%, #070b18 70%)`,
          }}
        />
      )}

      {/* Badge de categoría (arriba-izquierda) */}
      <span
        className="absolute left-2 top-2 inline-flex h-5 items-center rounded-[var(--radius-sm)] px-2 text-[9px] font-semibold uppercase tracking-[0.12em]"
        style={{
          background: 'rgba(4,6,14,.7)',
          color: meta.accent,
          backdropFilter: 'blur(4px)',
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

      {/* Overlay "Próximamente" para no jugables */}
      {!playable && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-[rgba(4,6,14,.65)] backdrop-blur-[1px]">
          <Lock className="size-4 text-[var(--color-fg-muted)]" />
          <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg)]">
            Próximamente
          </span>
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

  return (
    <Link
      href={`/play/games/${game.code}/play/iframe`}
      className="group flex flex-col gap-2"
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
