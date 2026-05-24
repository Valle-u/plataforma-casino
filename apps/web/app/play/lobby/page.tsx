/**
 * /play/lobby — catálogo de juegos del tenant (Sprint 51.13 dopamine
 * pass).
 *
 * Composición:
 *   1. Hero promocional dinámico arriba — depende del estado del
 *      player: si tiene la ruleta diaria lista, prime ese CTA; sino
 *      muestra el game destacado del catálogo; sino fallback genérico.
 *   2. Strip "Destacados" — horizontal scroll-snap en mobile, grid
 *      en desktop. Cards grandes con shimmer en juegos featured.
 *   3. Tabs por categoría.
 *   4. Grid de GameCard por categoría.
 *
 * Dopamine drivers:
 *   - Hero banner cambia según contexto (no es estático).
 *   - GameCard con aspect portrait, gradient bottom-to-top sobre la
 *     thumb (texto legible + sensación premium), scale on hover/tap.
 *   - Shimmer animation en cards de juegos destacados.
 *   - Pill de categoría coloreada sobre la thumb (no debajo).
 *
 * Backend (sin cambios):
 *   - GET /tenant/games/active?category=&featuredOnly=
 *   - GET /tenant/promotions/active (para el hero condicional)
 */

'use client';

import {
  ChevronRight,
  Coins,
  Dice5,
  Flame,
  Gauge,
  Gift,
  Info,
  Lock,
  Rocket,
  Search,
  Sparkles,
  TrendingUp,
  Trophy,
  X,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState, type CSSProperties } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { HeroCarousel, type HeroSlide } from '@/components/player/hero-carousel';
import {
  useActivePromotions,
  useMyStreak,
  useMyWheelRewards,
  todayUtcAnchor,
} from '@/lib/hooks/use-player-promotions';
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

const CATEGORY_ACCENT: Record<GameCategory, string> = {
  slots: '#FFD700', // dorado
  crash: '#FF6B35', // naranja
  table: '#4F9BFF', // azul
  live: '#C53030', // rojo (live = hot)
};

function isPlayable(game: PlayerGame): boolean {
  // Mock games (mock_*) son playables. Otros sin engine real → no.
  return game.code.startsWith('mock_');
}

export default function PlayLobbyPage() {
  const all = useActiveGames();
  const featured = useActiveGames({ featuredOnly: true });
  const [tab, setTab] = useState<Tab>('all');
  const [search, setSearch] = useState('');

  const games = all.data?.data ?? [];
  const playableCount = games.filter(isPlayable).length;

  // Sprint 51.21: filtro combinado tab + search. Si hay search, ignora
  // el grouping by category — un solo grid plano.
  const searchNorm = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    let list = games;
    if (tab !== 'all') list = list.filter((g) => g.category === tab);
    if (searchNorm) {
      list = list.filter(
        (g) =>
          g.name.toLowerCase().includes(searchNorm) ||
          g.code.toLowerCase().includes(searchNorm),
      );
    }
    return list;
  }, [games, tab, searchNorm]);

  const grouped = useMemo(() => {
    const map = new Map<GameCategory, PlayerGame[]>();
    for (const g of games) {
      const list = map.get(g.category) ?? [];
      list.push(g);
      map.set(g.category, list);
    }
    return Array.from(map.entries());
  }, [games]);

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col gap-6 sm:gap-8">
      {/* Sprint 51.14: carrusel hero con autoplay + Ken Burns + crossfade */}
      <DynamicHeroCarousel />

      {/* Header — fade-up con leve delay para que entre después del hero */}
      <header
        className="flex flex-col gap-2 animate-fade-up"
        style={{ animationDelay: '60ms', animationFillMode: 'both' }}
      >
        <span className="text-[10px] sm:text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
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

      {/* Sprint 51.21: search bar prominente arriba de los tabs */}
      <div
        className="animate-fade-up"
        style={{ animationDelay: '120ms', animationFillMode: 'both' }}
      >
        <SearchBar value={search} onChange={setSearch} />
      </div>

      {/* Destacados — solo si hay, tab=all y NO está buscando.
        * Si está buscando, los featured se mostrarían fuera de contexto
        * (no respetan el filtro), así que los ocultamos. */}
      {featured.data?.data &&
        featured.data.data.length > 0 &&
        tab === 'all' &&
        !searchNorm && (
          <div
            className="animate-fade-up"
            style={{ animationDelay: '180ms', animationFillMode: 'both' }}
          >
            <FeaturedStrip games={featured.data.data} />
          </div>
        )}

      {/* Tabs — Sprint 51.21 rediseño tipo Mega Mooney Maker: ícono
        * grande arriba del label, distribuido equitativamente, active
        * con accent + glow sutil. */}
      <div
        className="animate-fade-up"
        style={{ animationDelay: '240ms', animationFillMode: 'both' }}
      >
        <CategoryTabs value={tab} onChange={setTab} />
      </div>

      {/* Content */}
      <div
        className="animate-fade-up"
        style={{ animationDelay: '300ms', animationFillMode: 'both' }}
      >
        {all.isLoading ? (
          <LoadingGrid />
        ) : all.isError ? (
          <EmptyState hint="games" label="No se pudo cargar el catálogo." />
        ) : filtered.length === 0 ? (
          <EmptyState
            hint="games"
            label={
              searchNorm
                ? `No encontramos juegos para "${search}".`
                : 'No hay juegos en esta categoría.'
            }
          />
        ) : tab === 'all' && !searchNorm ? (
          <div className="flex flex-col gap-8">
            {grouped.map(([category, list]) => (
              <CategorySection key={category} category={category} games={list} />
            ))}
          </div>
        ) : (
          <>
            {searchNorm && (
              <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-medium mb-3">
                {filtered.length}{' '}
                {filtered.length === 1 ? 'resultado' : 'resultados'} para "
                {search}"
              </div>
            )}
            <Grid games={filtered} />
          </>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Sprint 51.21: Search bar prominente
// ──────────────────────────────────────────────────────────────────────

/**
 * SearchBar — input full-width estilo Mega Mooney Maker.
 *
 * Filtra client-side por `name` o `code` del juego. Búsqueda instantánea
 * (sin debounce — la lista es chica, no llega ni a 100 juegos en
 * producción esperada).
 *
 * UI: card-premium con icono Search a la izquierda, input transparente,
 * botón X para limpiar a la derecha. Focus state con border accent +
 * glow accent (refuerza dónde está el cursor).
 */
function SearchBar({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div
      className={cn(
        'group relative flex items-center gap-3 px-4 h-12 sm:h-14',
        'card-premium rounded-[var(--radius-lg)]',
        'focus-within:border-[var(--color-accent)]',
        'focus-within:shadow-[var(--shadow-edge-strong),0_0_0_1px_var(--color-accent-glow),var(--shadow-md)]',
        'transition-all duration-200',
      )}
    >
      <Search className="size-4 text-[var(--color-fg-subtle)] group-focus-within:text-[var(--color-accent-text)] transition-colors shrink-0" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Buscar juegos…"
        aria-label="Buscar juegos por nombre"
        className={cn(
          'flex-1 bg-transparent text-[14px] sm:text-[15px]',
          'text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)]',
          'outline-none border-0',
          // Quitar el "X" nativo del input search en Chrome/Edge
          '[&::-webkit-search-cancel-button]:hidden',
        )}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Limpiar búsqueda"
          className={cn(
            'size-7 flex items-center justify-center rounded-full shrink-0',
            'text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]',
            'hover:bg-[var(--color-bg-subtle)] transition-colors',
          )}
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Sprint 51.21: Tabs de categoría con ícono arriba (estilo MMM)
// ──────────────────────────────────────────────────────────────────────

/**
 * CategoryTabs — distribución equitativa de 5 tabs con ícono ARRIBA del
 * label (no inline). Active state con accent y subtle glow. Hover sutil.
 *
 * Layout:
 *   - Mobile: scroll horizontal (cada tab fija width 96px).
 *   - md+: grid equitativo (1fr cada uno) max-w fluida.
 *
 * Vs el chip strip anterior: ocupa más altura pero es más legible y
 * touch-friendly. Inspirado en Mega Mooney Maker / Stake / Roobet.
 */
function CategoryTabs({
  value,
  onChange,
}: {
  value: Tab;
  onChange: (next: Tab) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Filtrar por categoría"
      className={cn(
        'card-premium rounded-[var(--radius-lg)] p-1.5',
        'flex md:grid md:grid-cols-5 gap-1',
        'overflow-x-auto md:overflow-visible',
        '-mx-1 md:mx-0 px-1 md:px-1.5',
      )}
    >
      {TABS.map((t) => {
        const Icon = t.icon;
        const active = value === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={cn(
              'relative flex flex-col items-center justify-center gap-1.5',
              'shrink-0 w-[88px] md:w-auto h-16 md:h-[68px]',
              'rounded-[var(--radius)]',
              'transition-all duration-200 ease-out',
              'group/tab',
              active
                ? 'bg-[var(--color-accent-subtle)] text-[var(--color-fg)] shadow-[var(--shadow-edge),inset_0_0_0_1px_var(--color-accent)]'
                : 'text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]',
            )}
          >
            <Icon
              className={cn(
                'size-5 transition-transform duration-200',
                active
                  ? 'text-[var(--color-accent-text)] scale-110'
                  : 'group-hover/tab:scale-110',
              )}
            />
            <span className="text-[10px] uppercase tracking-[0.08em] font-medium leading-none">
              {t.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Sprint 51.14: Dynamic Hero Carousel
// ──────────────────────────────────────────────────────────────────────

/**
 * Carrusel hero al tope del lobby. La primera slide es DINÁMICA según
 * estado del player (ruleta lista, streak no claimed), luego rota por
 * un set fijo de slides curados (categorías + liga + bonos).
 *
 * Diseño:
 *   - Mientras backend carga las promos: skeleton (no parpadeo).
 *   - Slide #1 según prioridad: wheel ready → streak claim → fallback welcome.
 *   - Slides #2..#5 siempre presentes: slots, crash, mesa, liga.
 *   - El primero (eager) carga con fetchpriority=high para LCP rápido.
 */
function DynamicHeroCarousel() {
  const wheels = useActivePromotions('daily_wheel');
  const streaks = useActivePromotions('login_streak');
  const wheel = wheels.data?.data[0];
  const streak = streaks.data?.data[0];

  const wheelRewards = useMyWheelRewards(wheel?.id ?? null);
  const todayAnchor = todayUtcAnchor();
  const spunToday =
    wheelRewards.data?.data.some(
      (r) =>
        (r.metadata as { dayAnchor?: string } | null)?.dayAnchor ===
        todayAnchor,
    ) ?? false;

  const streakInfo = useMyStreak(streak?.id ?? null);
  const claimedToday =
    streakInfo.data?.progress?.lastClaimDay === todayAnchor;
  const currentStreakDay = streakInfo.data?.progress?.streak ?? 0;

  const isLoading =
    wheels.isLoading || streaks.isLoading || wheelRewards.isLoading;

  const slides = useMemo<HeroSlide[]>(() => {
    const list: HeroSlide[] = [];

    // ── Slide dinámico #1 según estado ───────────────────────────
    if (wheel && !spunToday) {
      list.push({
        id: 'dyn-wheel',
        image: 'welcome',
        href: '/play/wheel',
        icon: Sparkles,
        accentColor: '#FFD700',
        glow: 'rgba(255,215,0,0.45)',
        kicker: 'Ruleta diaria',
        title: 'Tu giro está esperando',
        body: 'Premios desde 50 hasta 1.000 chips. Solo hoy.',
        cta: 'Girar ahora',
      });
    } else if (streak && !claimedToday) {
      const nextDay = currentStreakDay + 1;
      list.push({
        id: 'dyn-streak',
        image: 'bonus',
        href: '/play/streak',
        icon: Flame,
        accentColor: '#FF6B35',
        glow: 'rgba(255,107,53,0.45)',
        kicker: `Racha · día ${nextDay}`,
        title: 'Reclamá tu premio diario',
        body:
          currentStreakDay > 0
            ? `Vas día ${currentStreakDay}. Hoy podés ganar más que ayer.`
            : 'Empezá tu racha y ganá premios escalonados.',
        cta: 'Reclamar',
      });
    } else {
      // Fallback welcome cuando ya completó dailies.
      list.push({
        id: 'welcome',
        image: 'welcome',
        href: '/play/lobby',
        icon: Sparkles,
        accentColor: 'var(--color-accent)',
        glow: 'rgba(220,38,38,0.45)',
        kicker: 'Bienvenido',
        title: 'Tu casino te está esperando',
        body: 'Explorá el catálogo, ganá la liga y reclamá tus bonos.',
        cta: 'Explorar',
      });
    }

    // ── Slides curados fijos ──────────────────────────────────────
    list.push(
      {
        id: 'slots',
        image: 'slots',
        href: '/play/lobby',
        icon: Coins,
        accentColor: '#FFD700',
        glow: 'rgba(255,215,0,0.4)',
        kicker: 'Slots dorados',
        title: 'Hacé girar los carretes',
        body: 'Decenas de tragamonedas con jackpots progresivos.',
        cta: 'Ver slots',
      },
      {
        id: 'crash',
        image: 'crash',
        href: '/play/lobby',
        icon: Rocket,
        accentColor: '#FF6B35',
        glow: 'rgba(255,107,53,0.4)',
        kicker: 'Crash games',
        title: 'Subí alto antes de explotar',
        body: 'Multiplicadores en tiempo real. Salí cuando sientas el riesgo.',
        cta: 'Volar',
      },
      {
        id: 'table',
        image: 'roulette',
        href: '/play/lobby',
        icon: Dice5,
        accentColor: '#4F9BFF',
        glow: 'rgba(79,155,255,0.4)',
        kicker: 'Mesas clásicas',
        title: 'Ruleta, blackjack y más',
        body: 'La casa de siempre, ahora en tu bolsillo.',
        cta: 'Ver mesas',
      },
      {
        id: 'league',
        image: 'league',
        href: '/play/lobby',
        icon: Trophy,
        accentColor: '#FFD700',
        glow: 'rgba(255,215,0,0.45)',
        kicker: 'Liga activa',
        title: 'Subí al podio esta semana',
        body: 'Top 10 se llevan premios. Sumá puntos jugando lo que más te guste.',
        cta: 'Ver liga',
      },
      {
        id: 'bonus',
        image: 'bonus',
        href: '/play/bonuses',
        icon: Gift,
        accentColor: '#FFD700',
        glow: 'rgba(255,215,0,0.4)',
        kicker: 'Bonos disponibles',
        title: 'Sumá chips extra',
        body: 'Aprovechá los bonos que tu cajero activó para vos.',
        cta: 'Ver bonos',
      },
    );

    return list;
  }, [
    wheel,
    spunToday,
    streak,
    claimedToday,
    currentStreakDay,
  ]);

  if (isLoading) {
    return (
      <Skeleton className="h-[280px] sm:h-[380px] lg:h-[460px] w-full bg-[var(--color-bg-elevated)] rounded-[var(--radius-xl)]" />
    );
  }

  return <HeroCarousel slides={slides} intervalMs={6000} />;
}

// ──────────────────────────────────────────────────────────────────────
// Featured strip — horizontal scroll snap en mobile
// ──────────────────────────────────────────────────────────────────────

function FeaturedStrip({ games }: { games: PlayerGame[] }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Sparkles className="size-3.5 text-[var(--color-accent-text)]" />
        <span className="text-[10px] sm:text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-medium">
          Destacados
        </span>
      </div>
      {/* Mobile: scroll horizontal snap. Desktop: grid normal. */}
      <div className="flex sm:grid sm:grid-cols-3 lg:grid-cols-4 gap-3 overflow-x-auto sm:overflow-visible -mx-4 sm:-mx-0 px-4 sm:px-0 pb-2 sm:pb-0 snap-x snap-mandatory sm:snap-none">
        {games.slice(0, 6).map((g) => (
          <div
            key={g.id}
            className="snap-start shrink-0 w-[160px] sm:w-auto"
          >
            <GameCard game={g} size="lg" shimmer />
          </div>
        ))}
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Category section
// ──────────────────────────────────────────────────────────────────────

function CategorySection({
  category,
  games,
}: {
  category: GameCategory;
  games: PlayerGame[];
}) {
  const accent = CATEGORY_ACCENT[category];
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] sm:text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
          <span
            className="size-1.5 rounded-full"
            style={{ background: accent }}
            aria-hidden
          />
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
    // Sprint 51.21: más denso — 6 cols en lg como Mega Mooney Maker.
    // Las cards ahora son square (1:1), entran más en menos espacio.
    <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
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
  shimmer = false,
}: {
  game: PlayerGame;
  size?: 'sm' | 'lg';
  shimmer?: boolean;
}) {
  const playable = isPlayable(game);
  const categoryAccent = CATEGORY_ACCENT[game.category];

  // Sprint 51.13: aspect portrait (3/4) en vez de 4/3 — más visualmente
  // impactante en mobile y ocupa mejor el espacio. Slot machines
  // tradicionales usan portrait.
  const body = (
    <>
      <div
        className={cn(
          // Sprint 51.21: aspect 1:1 (square) en vez de 3:4 portrait.
          // Más estándar para live casino + tragamonedas + crash games.
          // Mega Mooney Maker / Stake / Roobet usan 1:1 o 4:3, casi nunca
          // portrait. El portrait quedaba raro en algunos thumbnails.
          'relative w-full aspect-square overflow-hidden rounded-[var(--radius)]',
          'bg-[var(--color-bg-subtle)]',
          'flex items-center justify-center',
        )}
      >
        {game.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={game.thumbnailUrl}
            alt={game.name}
            className={cn(
              'w-full h-full object-cover transition-transform duration-300',
              playable && 'group-hover:scale-105',
              !playable && 'grayscale-[60%] opacity-60',
            )}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <ThumbPlaceholder game={game} muted={!playable} />
        )}

        {/* Gradient bottom-to-top sobre la thumb — texto legible */}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-1/2 pointer-events-none"
          style={{
            background:
              'linear-gradient(to top, rgba(10,10,10,0.85) 0%, transparent 100%)',
          }}
        />

        {/* Pill de categoría sobre la thumb */}
        <span
          className="absolute top-2 left-2 px-2 h-5 inline-flex items-center text-[9px] uppercase tracking-[0.1em] font-mono font-medium"
          style={{
            background: `${categoryAccent}cc`,
            color: '#fff',
          }}
        >
          {CATEGORY_LABEL[game.category]}
        </span>

        {/* Destacado: badge dorado top-right */}
        {game.featured && playable && (
          <span className="absolute top-2 right-2 px-1.5 h-5 inline-flex items-center gap-1 text-[9px] uppercase tracking-[0.1em] font-mono font-medium bg-[#FFD700] text-black rounded-sm">
            <Flame className="size-2.5" />
            Hot
          </span>
        )}

        {/* Sprint 51.21: ícono "i" bottom-right — info del juego sin
          * salir del lobby. Visible only on hover en desktop, siempre
          * en mobile (touch). Tooltip nativo title= por ahora; futuro:
          * popover con provider, RTP, volatility. */}
        {playable && (
          <span
            aria-hidden
            title={`${game.name} · ${CATEGORY_LABEL[game.category]} · code: ${game.code}`}
            className={cn(
              'absolute bottom-2 right-2 z-10',
              'size-5 rounded-full flex items-center justify-center',
              'bg-black/50 backdrop-blur-sm text-white/80',
              'md:opacity-0 md:group-hover:opacity-100 transition-opacity',
            )}
          >
            <Info className="size-3" />
          </span>
        )}

        {/* Nombre overlay sobre el gradient */}
        <div className="absolute inset-x-2 bottom-2 z-10">
          <span
            className={cn(
              'block tracking-tight truncate font-medium drop-shadow',
              size === 'lg' ? 'text-[14px]' : 'text-[12px]',
              playable ? 'text-white' : 'text-[var(--color-fg-muted)]',
            )}
          >
            {game.name}
          </span>
        </div>

        {/* Overlay "Próximamente" para no playables */}
        {!playable && (
          <div
            aria-hidden
            className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-[rgba(10,10,10,0.65)] backdrop-blur-[1px] z-20"
          >
            <Lock className="size-4 text-[var(--color-fg-muted)]" />
            <span className="text-[10px] uppercase tracking-[0.14em] font-mono text-[var(--color-fg)]">
              Próximamente
            </span>
          </div>
        )}

        {/* Shimmer effect en cards destacadas */}
        {shimmer && playable && (
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none overflow-hidden"
          >
            <div className="absolute inset-y-0 -inset-x-full animate-shine bg-gradient-to-r from-transparent via-white/20 to-transparent" />
          </div>
        )}

        {/* Sprint 51.26: hover preview overlay (Netflix style).
          * Desktop only — slide up desde abajo al hover con provider,
          * description (si hay) y CTA "Jugar" prominente. Móvil sigue
          * con el icon "i" inline para info. */}
        {playable && (
          <div
            aria-hidden
            className={cn(
              'hidden md:flex absolute inset-x-0 bottom-0 z-20 flex-col gap-2 p-3',
              'bg-gradient-to-t from-black via-black/95 to-black/70',
              'opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0',
              'transition-all duration-300 ease-out pointer-events-none',
            )}
          >
            <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.12em] font-mono">
              <span
                className="size-1.5 rounded-full"
                style={{ background: categoryAccent }}
              />
              <span className="text-[var(--color-fg-muted)]">
                {game.providerCode}
              </span>
            </div>
            {game.shortDescription && (
              <p className="text-[11px] text-[var(--color-fg-muted)] leading-snug line-clamp-2">
                {game.shortDescription}
              </p>
            )}
            <div
              className="inline-flex items-center justify-center gap-1.5 h-8 px-3 mt-1 rounded-[var(--radius-sm)] text-[12px] font-medium tracking-tight text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.18)]"
              style={{
                background: `linear-gradient(180deg, ${categoryAccent}, ${categoryAccent}cc)`,
                boxShadow: `inset 0 1px 0 0 rgba(255,255,255,0.18), 0 4px 12px -3px ${categoryAccent}80`,
              }}
            >
              Jugar
              <ChevronRight className="size-3.5" />
            </div>
          </div>
        )}
      </div>
    </>
  );

  // No playable: no es link.
  if (!playable) {
    return (
      <div
        title="Este juego está en desarrollo. Próximamente disponible."
        aria-label={`${game.name} — próximamente`}
        aria-disabled="true"
        className="flex flex-col gap-2 cursor-not-allowed select-none card-premium rounded-[var(--radius-lg)] p-1.5"
      >
        {body}
      </div>
    );
  }

  // Sprint 51.15: tilt 3D sutil + glow accent en hover.
  // Sprint 51.20: corners suaves + card-premium base.
  return (
    <Link
      href={`/play/games/${game.code}/play/iframe`}
      className={cn(
        'group relative flex flex-col gap-2 p-1.5',
        'card-premium rounded-[var(--radius-lg)]',
        'hover:border-[color:var(--card-accent)]',
        'transition-all duration-300 ease-out',
        'hover:-translate-y-1 hover:[transform:translateY(-4px)_rotateX(2deg)]',
        'active:scale-[0.97] active:translate-y-0',
        '[transform-style:preserve-3d] [perspective:600px]',
        'hover:shadow-[0_12px_30px_-8px_var(--card-glow)]',
      )}
      style={
        {
          // CSS custom props para que tailwind las pueda referenciar arriba.
          '--card-accent': categoryAccent,
          '--card-glow': `${categoryAccent}66`,
        } as CSSProperties
      }
    >
      {body}
    </Link>
  );
}

/**
 * Placeholder visual cuando no hay thumbnailUrl. Iniciales + ícono por
 * categoría. Coloreado por accent de la categoría (más visual que solo
 * el accent global).
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
  const categoryAccent = CATEGORY_ACCENT[game.category];
  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center gap-3"
      style={{
        background: muted
          ? 'var(--color-bg-subtle)'
          : `linear-gradient(135deg, ${categoryAccent}25 0%, ${categoryAccent}05 100%)`,
      }}
    >
      <Icon
        className={cn(
          'size-10 transition-transform',
          !muted && 'group-hover:scale-110',
        )}
        style={{
          color: muted ? 'var(--color-fg-disabled)' : categoryAccent,
        }}
      />
      <span
        className="font-display text-3xl tracking-tight"
        style={{ color: muted ? 'var(--color-fg-disabled)' : categoryAccent }}
      >
        {initials}
      </span>
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
        <Skeleton
          key={i}
          className="w-full aspect-[3/4] bg-[var(--color-bg-subtle)]"
        />
      ))}
    </div>
  );
}
