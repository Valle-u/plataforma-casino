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
  Lock,
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

/**
 * Sprint 47: criterio para decidir si un game tiene engine real o es
 * placeholder ("Próximamente"). Hoy el único engine implementado es el
 * `MockGameProvider` para slots (Sprint 35). El resto de categorías
 * (crash, table, live) son vidriera comercial hasta que llegue:
 *   - Sprint 48+: crash propio (ver docs/own-games/).
 *   - Provider real externo (no tier 1 — decisión post-MVP).
 *
 * Un game se considera playable cuando:
 *   - `category === 'slots'` (única categoría con engine).
 *   - `providerCode === 'mock'` (futuro: agregar 'own', 'pragmatic', etc.
 *     cuando integremos providers reales).
 *
 * Esta función es la UNICA fuente de verdad del frontend. Cambiar el
 * criterio acá actualiza el lobby + el card overlay + el guard del click.
 */
function isPlayable(game: PlayerGame): boolean {
  return game.category === 'slots' && game.providerCode === 'mock';
}

export default function PlayLobbyPage() {
  const [tab, setTab] = useState<Tab>('all');
  const all = useActiveGames();
  const featured = useActiveGames({ featuredOnly: true });

  const games = all.data?.data ?? [];
  const filtered = useMemo(
    () => (tab === 'all' ? games : games.filter((g) => g.category === tab)),
    [games, tab],
  );

  // Sprint 47: contamos los playables para el header informativo.
  const playableCount = useMemo(
    () => games.filter(isPlayable).length,
    [games],
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
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col gap-6 sm:gap-8">
      {/* Header */}
      <header className="flex flex-col gap-2">
        <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
          <Sparkles className="size-3" />
          Lobby
        </span>
        <h1 className="font-display text-2xl sm:text-[2.5rem] leading-tight sm:leading-none tracking-tight">
          Casino
        </h1>
        <p className="text-sm text-[var(--color-fg-muted)] mt-1">
          {all.isLoading ? (
            'Cargando catálogo…'
          ) : all.isError ? (
            'No se pudo cargar el catálogo.'
          ) : (
            <>
              <span className="text-[var(--color-fg)] font-mono">
                {playableCount}
              </span>{' '}
              {playableCount === 1 ? 'juego jugable' : 'juegos jugables'}
              {games.length > playableCount && (
                <>
                  {' '}
                  ·{' '}
                  <span className="text-[var(--color-fg-subtle)]">
                    {games.length - playableCount} próximamente
                  </span>
                </>
              )}
              .
            </>
          )}
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
        <Sparkles className="size-3.5 text-[var(--color-accent-text)]" />
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
  const playable = isPlayable(game);

  // Contenido común (thumbnail + nombre + categoría + badges).
  const body = (
    <>
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
            className={cn(
              'w-full h-full object-cover',
              !playable && 'grayscale-[60%] opacity-60',
            )}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <ThumbPlaceholder game={game} muted={!playable} />
        )}

        {/* Sprint 47: overlay "Próximamente" sobre cards no playables. */}
        {!playable && (
          <div
            aria-hidden
            className={cn(
              'absolute inset-0 flex flex-col items-center justify-center gap-1.5',
              'bg-[rgba(10,10,10,0.65)] backdrop-blur-[1px]',
              'border border-[var(--color-border-strong)]',
            )}
          >
            <Lock className="size-4 text-[var(--color-fg-muted)]" />
            <span className="text-[10px] uppercase tracking-[0.14em] font-mono text-[var(--color-fg)]">
              Próximamente
            </span>
          </div>
        )}

        {game.featured && playable && (
          <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] font-mono bg-[var(--color-accent)] text-[var(--color-accent-fg)]">
            Destacado
          </span>
        )}
      </div>

      <div className="flex flex-col gap-0.5">
        <span
          className={cn(
            'tracking-tight truncate',
            playable ? 'text-[var(--color-fg)]' : 'text-[var(--color-fg-muted)]',
            size === 'lg' ? 'text-[14px] font-medium' : 'text-[13px]',
          )}
        >
          {game.name}
        </span>
        <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] font-mono">
          {CATEGORY_LABEL[game.category]}
        </span>
      </div>
    </>
  );

  // Si NO es playable, renderizamos un `<div>` no-interactivo (no `<Link>`).
  // Esto previene navegación al iframe vacío y deja claro visualmente.
  if (!playable) {
    return (
      <div
        title="Este juego está en desarrollo. Próximamente disponible."
        aria-label={`${game.name} — próximamente`}
        aria-disabled="true"
        className={cn(
          'flex flex-col gap-2 p-3 cursor-not-allowed select-none',
          'bg-[var(--color-bg-elevated)] border border-[var(--color-border)]',
          size === 'lg' && 'p-4',
        )}
      >
        {body}
      </div>
    );
  }

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
      {body}
    </Link>
  );
}

/**
 * Placeholder visual cuando no hay thumbnailUrl. Iniciales + ícono por
 * categoría. `muted=true` (Sprint 47) baja la opacidad para juegos
 * "próximamente", para que la card se lea como vidriera en vez de CTA.
 */
function ThumbPlaceholder({
  game,
  muted = false,
}: {
  game: PlayerGame;
  muted?: boolean;
}) {
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
    <div
      className={cn(
        'flex flex-col items-center gap-2 transition-colors',
        muted
          ? 'text-[var(--color-fg-disabled)]'
          : 'text-[var(--color-fg-subtle)] group-hover:text-[var(--color-accent-text)]',
      )}
    >
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
