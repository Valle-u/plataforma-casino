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
  ArrowRight,
  Coins,
  Dice5,
  Flame,
  Gauge,
  Lock,
  Sparkles,
  TrendingUp,
  Trophy,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
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

  const games = all.data?.data ?? [];
  const playableCount = games.filter(isPlayable).length;

  const filtered = useMemo(() => {
    if (tab === 'all') return games;
    return games.filter((g) => g.category === tab);
  }, [games, tab]);

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
      {/* Sprint 51.13: hero dinámico arriba del fold */}
      <DynamicHero />

      {/* Header */}
      <header className="flex flex-col gap-2">
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

      {/* Destacados — solo si hay y tab=all */}
      {featured.data?.data && featured.data.data.length > 0 && tab === 'all' && (
        <FeaturedStrip games={featured.data.data} />
      )}

      {/* Tabs */}
      <div className="flex items-center gap-px bg-[var(--color-border)] border border-[var(--color-border)] self-start overflow-x-auto max-w-full">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'px-3 sm:px-4 h-10 sm:h-9 text-[11px] uppercase tracking-[0.08em] font-medium',
                'transition-colors duration-150 flex items-center gap-2 whitespace-nowrap shrink-0',
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
        <EmptyState hint="games" label="No se pudo cargar el catálogo." />
      ) : filtered.length === 0 ? (
        <EmptyState hint="games" label="No hay juegos en esta categoría." />
      ) : tab === 'all' ? (
        <div className="flex flex-col gap-8">
          {grouped.map(([category, list]) => (
            <CategorySection key={category} category={category} games={list} />
          ))}
        </div>
      ) : (
        <Grid games={filtered} />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Sprint 51.13: Dynamic Hero
// ──────────────────────────────────────────────────────────────────────

/**
 * Banner promocional dinámico al tope del lobby. Lee el estado del
 * player y muestra el CTA más prime según prioridad:
 *
 *   1. Si tiene la ruleta diaria SIN GIRAR hoy → "Reclamá tu giro"
 *      con fondo dorado.
 *   2. Si tiene streak activo y NO claimed hoy → "Día N · reclamá X"
 *      con fondo naranja.
 *   3. Fallback → CTA genérico "Jugá lo que más te guste" con fondo
 *      accent.
 *
 * El banner ocupa 1 sección visualmente impactante (gradient + glow)
 * que sirve de "vidriera" cuando el player entra. Es invisible si
 * ningún backend respondió aún (loading).
 */
function DynamicHero() {
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

  // Loading: skeleton para no parpadear con CTAs cambiando.
  const isLoading =
    wheels.isLoading || streaks.isLoading || wheelRewards.isLoading;
  if (isLoading) {
    return (
      <Skeleton className="h-32 sm:h-40 w-full bg-[var(--color-bg-elevated)]" />
    );
  }

  // Prioridad 1: ruleta diaria lista.
  if (wheel && !spunToday) {
    return (
      <HeroBanner
        href="/play/wheel"
        icon={Sparkles}
        accentColor="#FFD700"
        glow="rgba(255,215,0,0.35)"
        kicker="Ruleta diaria"
        title="Tu giro está esperando"
        body="Probá tu suerte hoy. Premios desde 50 hasta 1.000 chips."
        cta="Girar ahora"
      />
    );
  }

  // Prioridad 2: streak no claimed hoy.
  if (streak && !claimedToday) {
    const nextDay = currentStreakDay + 1;
    return (
      <HeroBanner
        href="/play/streak"
        icon={Flame}
        accentColor="#FF6B35"
        glow="rgba(255,107,53,0.35)"
        kicker={`Racha de login · día ${nextDay}`}
        title="Reclamá tu premio diario"
        body={
          currentStreakDay > 0
            ? `Vas día ${currentStreakDay}. Hoy podés ganar más que ayer.`
            : 'Empezá tu racha y ganá premios escalonados.'
        }
        cta="Reclamar"
      />
    );
  }

  // Prioridad 3: ya completó dailies, mostrar liga.
  return (
    <HeroBanner
      href="/play/lobby"
      icon={Trophy}
      accentColor="var(--color-accent)"
      glow="var(--color-accent-glow)"
      kicker="Liga activa"
      title="Subí tu posición"
      body="Jugá ahora y sumá puntos para entrar al top 10 y ganar premios."
      cta="Jugar"
    />
  );
}

function HeroBanner({
  href,
  icon: Icon,
  accentColor,
  glow,
  kicker,
  title,
  body,
  cta,
}: {
  href: string;
  icon: LucideIcon;
  accentColor: string;
  glow: string;
  kicker: string;
  title: string;
  body: string;
  cta: string;
}) {
  return (
    <Link
      href={href}
      className="relative group block overflow-hidden border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-5 sm:p-8 active:scale-[0.99] transition-transform"
      style={{ borderLeftColor: accentColor, borderLeftWidth: '3px' }}
    >
      {/* Glow decorativo */}
      <div
        aria-hidden
        className="absolute -inset-x-12 -top-12 h-48 opacity-40 blur-3xl pointer-events-none transition-opacity group-hover:opacity-60"
        style={{
          background: `radial-gradient(ellipse at center, ${glow} 0%, transparent 65%)`,
        }}
      />
      <div className="relative flex items-center gap-4 sm:gap-6">
        <div
          className="hidden sm:flex items-center justify-center size-16 rounded-full shrink-0"
          style={{
            background: `linear-gradient(135deg, ${accentColor}30, ${accentColor}10)`,
            border: `1px solid ${accentColor}`,
          }}
        >
          <Icon className="size-7" style={{ color: accentColor }} />
        </div>
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <span
            className="text-[10px] sm:text-[11px] uppercase tracking-[0.14em] font-medium"
            style={{ color: accentColor }}
          >
            {kicker}
          </span>
          <h2 className="font-display text-xl sm:text-3xl leading-tight tracking-tight text-[var(--color-fg)]">
            {title}
          </h2>
          <p className="text-[12px] sm:text-[13px] text-[var(--color-fg-muted)] mt-0.5">
            {body}
          </p>
        </div>
        {/* CTA visible — mobile compact, desktop spelled out */}
        <div className="hidden sm:flex shrink-0">
          <span
            className="inline-flex items-center gap-2 px-4 h-10 text-[13px] font-medium tracking-tight"
            style={{
              background: accentColor,
              color: '#fff',
            }}
          >
            {cta}
            <ArrowRight className="size-3.5" />
          </span>
        </div>
        <ArrowRight
          className="sm:hidden size-5 shrink-0 transition-transform group-hover:translate-x-1"
          style={{ color: accentColor }}
        />
      </div>
    </Link>
  );
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
          'relative w-full aspect-[3/4] overflow-hidden',
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
          <span className="absolute top-2 right-2 px-1.5 h-5 inline-flex items-center gap-1 text-[9px] uppercase tracking-[0.1em] font-mono font-medium bg-[#FFD700] text-black">
            <Flame className="size-2.5" />
            Hot
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
        className="flex flex-col gap-2 cursor-not-allowed select-none bg-[var(--color-bg-elevated)] border border-[var(--color-border)]"
      >
        {body}
      </div>
    );
  }

  return (
    <Link
      href={`/play/games/${game.code}/play/iframe`}
      className={cn(
        'group flex flex-col gap-2',
        'bg-[var(--color-bg-elevated)] border border-[var(--color-border)]',
        'hover:border-[var(--color-accent)] active:scale-[0.97]',
        'transition-all duration-150',
      )}
      style={{
        // Hover glow sutil (CSS-only via group-hover boxshadow no es directo;
        // dejamos el border-accent + transform como afford).
      }}
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
