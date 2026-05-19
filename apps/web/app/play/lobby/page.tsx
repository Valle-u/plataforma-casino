/**
 * /play/lobby — catálogo de juegos del tenant.
 *
 * Composición:
 *   - Header con stat de "X juegos disponibles".
 *   - Banda "Destacados" (featured=true) si hay.
 *   - Tabs por categoría: Todas / Slots / Crash / Mesa / En vivo.
 *   - Grid de GameCard por categoría seleccionada.
 *   - Click en card → /play/games/<code>/play (stub Sprint 34, real Sprint 35).
 *
 * Backend:
 *   - GET /tenant/games/active?category=&featuredOnly=
 */

'use client';

import {
  Coins,
  Dice5,
  Gauge,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
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

type Tab = 'all' | GameCategory;

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'all', label: 'Todos', icon: Sparkles },
  { id: 'slots', label: 'Slots', icon: Coins },
  { id: 'crash', label: 'Crash', icon: TrendingUp },
  { id: 'table', label: 'Mesa', icon: Dice5 },
  { id: 'live', label: 'En vivo', icon: Gauge },
];

const CATEGORY_LABEL: Record<GameCategory, string> = {
  slots: 'Slots',
  crash: 'Crash',
  table: 'Mesa',
  live: 'En vivo',
};

export default function PlayLobbyPage() {
  const [tab, setTab] = useState<Tab>('all');
  const all = useActiveGames();
  const featured = useActiveGames({ featuredOnly: true });

  const games = all.data?.data ?? [];
  const filtered = useMemo(
    () => (tab === 'all' ? games : games.filter((g) => g.category === tab)),
    [games, tab],
  );

  // Agrupar por category para vista "Todos".
  const grouped = useMemo(() => {
    const map = new Map<GameCategory, PlayerGame[]>();
    for (const g of filtered) {
      if (!map.has(g.category)) map.set(g.category, []);
      map.get(g.category)!.push(g);
    }
    return Array.from(map.entries());
  }, [filtered]);

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-10 flex flex-col gap-8">
      {/* Header */}
      <header className="flex flex-col gap-2">
        <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
          <Sparkles className="size-3" />
          Lobby
        </span>
        <h1 className="font-display text-[2.5rem] leading-none tracking-tight">
          Casino
        </h1>
        <p className="text-sm text-[var(--color-fg-muted)] mt-1">
          {all.isLoading
            ? 'Cargando catálogo…'
            : all.isError
              ? 'No se pudo cargar el catálogo.'
              : `${games.length} ${games.length === 1 ? 'juego disponible' : 'juegos disponibles'}.`}
        </p>
      </header>

      {/* Destacados */}
      {featured.data?.data && featured.data.data.length > 0 && tab === 'all' && (
        <FeaturedStrip games={featured.data.data} />
      )}

      {/* Tabs */}
      <div className="flex items-center gap-px bg-[var(--color-border)] border border-[var(--color-border)] self-start overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'px-4 h-9 text-[11px] uppercase tracking-[0.08em] font-medium',
                'transition-colors duration-150 flex items-center gap-2',
                tab === t.id
                  ? 'bg-[var(--color-bg)] text-[var(--color-fg)] border-b-2 border-b-[var(--color-accent)]'
                  : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]',
              )}
            >
              <Icon className="size-3" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {all.isLoading ? (
        <LoadingGrid />
      ) : all.isError ? (
        <EmptyState
          hint="games"
          label="No se pudo cargar el catálogo."
        />
      ) : filtered.length === 0 ? (
        <EmptyState hint="games" label="No hay juegos en esta categoría." />
      ) : tab === 'all' ? (
        <div className="flex flex-col gap-8">
          {grouped.map(([category, list]) => (
            <CategorySection
              key={category}
              category={category}
              games={list}
            />
          ))}
        </div>
      ) : (
        <Grid games={filtered} />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Destacados strip
// ──────────────────────────────────────────────────────────────────────

function FeaturedStrip({ games }: { games: PlayerGame[] }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Sparkles className="size-3.5 text-[var(--color-accent)]" />
        <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-medium">
          Destacados
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {games.slice(0, 4).map((g) => (
          <GameCard key={g.id} game={g} size="lg" />
        ))}
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Category section ("Slots", "Crash", etc.)
// ──────────────────────────────────────────────────────────────────────

function CategorySection({
  category,
  games,
}: {
  category: GameCategory;
  games: PlayerGame[];
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-medium">
          {CATEGORY_LABEL[category]}{' '}
          <span className="text-[var(--color-fg-subtle)]">· {games.length}</span>
        </span>
      </div>
      <Grid games={games} />
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Grid + GameCard
// ──────────────────────────────────────────────────────────────────────

function Grid({ games }: { games: PlayerGame[] }) {
  return (
    <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
      {games.map((g, i) => (
        <li
          key={g.id}
          className="animate-fade-up-staggered"
          style={{ animationDelay: `${Math.min(i * 20, 400)}ms` }}
        >
          <GameCard game={g} />
        </li>
      ))}
    </ul>
  );
}

function GameCard({
  game,
  size = 'sm',
}: {
  game: PlayerGame;
  size?: 'sm' | 'lg';
}) {
  return (
    <Link
      href={`/play/games/${game.code}/play/iframe`}
      className={cn(
        'group flex flex-col gap-2 p-3',
        'bg-[var(--color-bg-elevated)] border border-[var(--color-border)]',
        'hover:border-[var(--color-accent)] transition-colors',
        size === 'lg' && 'p-4',
      )}
    >
      {/* Thumbnail (o placeholder generado) */}
      <div
        className={cn(
          'relative w-full aspect-[4/3] overflow-hidden',
          'bg-[var(--color-bg-subtle)] border border-[var(--color-border)]',
          'flex items-center justify-center',
        )}
      >
        {game.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={game.thumbnailUrl}
            alt={game.name}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <ThumbPlaceholder game={game} />
        )}
        {game.featured && (
          <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] font-mono bg-[var(--color-accent)] text-[var(--color-accent-fg)]">
            Destacado
          </span>
        )}
      </div>

      <div className="flex flex-col gap-0.5">
        <span
          className={cn(
            'text-[var(--color-fg)] tracking-tight truncate',
            size === 'lg' ? 'text-[14px] font-medium' : 'text-[13px]',
          )}
        >
          {game.name}
        </span>
        <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] font-mono">
          {CATEGORY_LABEL[game.category]}
        </span>
      </div>
    </Link>
  );
}

/** Placeholder visual cuando no hay thumbnailUrl. Iniciales + color. */
function ThumbPlaceholder({ game }: { game: PlayerGame }) {
  const initials = game.name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const Icon =
    game.category === 'slots'
      ? Coins
      : game.category === 'crash'
        ? TrendingUp
        : game.category === 'table'
          ? Dice5
          : Gauge;
  return (
    <div className="flex flex-col items-center gap-2 text-[var(--color-fg-subtle)] group-hover:text-[var(--color-accent)] transition-colors">
      <Icon className="size-8" />
      <span className="font-display text-2xl tracking-tight">{initials}</span>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Loading state
// ──────────────────────────────────────────────────────────────────────

function LoadingGrid() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
      {Array.from({ length: 10 }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col gap-2 p-3 bg-[var(--color-bg-elevated)] border border-[var(--color-border)]"
        >
          <Skeleton className="w-full aspect-[4/3] bg-[var(--color-bg-subtle)]" />
          <Skeleton className="h-4 w-3/4 bg-[var(--color-bg-subtle)]" />
          <Skeleton className="h-3 w-1/2 bg-[var(--color-bg-subtle)]" />
        </div>
      ))}
    </div>
  );
}
