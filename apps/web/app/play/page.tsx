/**
 * /play — dashboard del jugador (Sprint 54 rediseño "modo simple").
 *
 * Rediseño completo orientado a usuarios mayores y/o poco familiarizados
 * con UI moderna. El objetivo del pedido del dueño: "que sea fácil de
 * interactuar y que los juegos estén visibles".
 *
 * Composición (3 bloques, en orden de prioridad):
 *
 *   1. Hero — saludo + saldo + 2 botones grandes (Depositar / Retirar).
 *      Sin sparkline, sin KPI row, sin chip de racha. El número del
 *      saldo es lo único que destaca; lo demás respira.
 *
 *   2. Jugar — título grande + grid de 6 juegos (3 cols desktop, 2 mobile).
 *      Cards medianas (HomeGameCard, no la del lobby): thumb + nombre
 *      legible 16px. Sin tilt 3D, sin shimmer. CTA secundario "Ver todos
 *      los juegos" debajo del grid.
 *
 *   3. Más opciones — 2 botones grandes (Bonos · Mis movimientos)
 *      como tarjetas. El resto (racha, ruleta diaria, ligas, achievements,
 *      VIP) sigue accesible desde la nav del header, pero NO acá — la
 *      home no debe abrumar.
 *
 * Comparado con el dashboard anterior (Sprint 51.16):
 *   - REMOVIDO: sparkline, KpiRow, MissionsStrip, VipTierCard,
 *     LeagueInlineCard, Recent activity list, 4 quick action tiles.
 *   - REEMPLAZADO: ese stack de 7 secciones + 6 widgets flotantes por
 *     este layout de 3 bloques.
 *
 * Tipografía: base 16px (text-base) en lugar de 10-13px que tenía el
 * dashboard premium. Botones tap-friendly ≥56px. Contraste subido — sin
 * uppercase mini en fg-subtle.
 *
 * Floating widgets: ver `play/layout.tsx` — los widgets de marketing
 * (LiveWinsTicker, FloatingLeagueWidget, FloatingMissionsWidget) están
 * deshabilitados cuando pathname === '/play'. Watchers de notificación
 * real (WinToastWatcher, AchievementUnlockWatcher) siguen activos.
 */

'use client';

import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpToLine,
  Gift,
  Receipt,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';
import { HomeGameCard } from '@/components/player/home-game-card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth-context';
import { useActiveGames, type PlayerGame } from '@/lib/hooks/use-games';
import { useAnimatedNumber } from '@/lib/hooks/use-animated-number';
import { useMyWallet } from '@/lib/hooks/use-wallet';

const HOME_GAMES_COUNT = 6;

/**
 * Filtra a juegos jugables. Mock games tienen engine real — el resto
 * son placeholders hasta que se integre el aggregator (igual criterio
 * que `/play/lobby`).
 */
function isPlayable(g: PlayerGame): boolean {
  return g.code.startsWith('mock_');
}

/**
 * Selecciona los juegos a mostrar en la home. Prioridad:
 *   1. Featured + playable, ordenados por sortOrder.
 *   2. Si no llega a 6, completa con playables no-featured (mismo orden).
 *
 * Hasta `HOME_GAMES_COUNT`. Si hay menos juegos totales, devuelve los
 * que haya — la grid se autoacomoda.
 */
function pickHomeGames(
  featured: PlayerGame[] | undefined,
  all: PlayerGame[] | undefined,
): PlayerGame[] {
  const byOrder = (a: PlayerGame, b: PlayerGame) => a.sortOrder - b.sortOrder;
  const featuredPlayable = (featured ?? []).filter(isPlayable).sort(byOrder);
  if (featuredPlayable.length >= HOME_GAMES_COUNT) {
    return featuredPlayable.slice(0, HOME_GAMES_COUNT);
  }
  const ids = new Set(featuredPlayable.map((g) => g.id));
  const fillers = (all ?? [])
    .filter((g) => isPlayable(g) && !ids.has(g.id))
    .sort(byOrder)
    .slice(0, HOME_GAMES_COUNT - featuredPlayable.length);
  return [...featuredPlayable, ...fillers];
}

function greetingFor(now: Date): string {
  const h = now.getHours();
  if (h >= 5 && h < 12) return 'Buen día';
  if (h >= 12 && h < 19) return 'Buenas tardes';
  if (h >= 19 && h < 22) return 'Buenas noches';
  return 'Hola';
}

export default function PlayHomePage() {
  const { user } = useAuth();
  const wallet = useMyWallet();
  const featured = useActiveGames({ featuredOnly: true });
  const all = useActiveGames();

  const games = useMemo(
    () => pickHomeGames(featured.data?.data, all.data?.data),
    [featured.data?.data, all.data?.data],
  );

  const loadingGames = featured.isLoading || all.isLoading;
  const firstName =
    user?.displayName?.split(' ')[0] ?? user?.username ?? 'jugador';
  const greeting = greetingFor(new Date());

  return (
    <div className="max-w-[1000px] mx-auto px-4 sm:px-6 py-8 sm:py-12 flex flex-col gap-12 sm:gap-16">
      <HeroSection
        greeting={greeting}
        firstName={firstName}
        balance={wallet.data?.balance ?? '0'}
        loading={wallet.isLoading}
      />
      <GamesSection games={games} loading={loadingGames} />
      <MoreOptionsSection />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Hero — saludo + saldo + acciones primarias
// ──────────────────────────────────────────────────────────────────────

function HeroSection({
  greeting,
  firstName,
  balance,
  loading,
}: {
  greeting: string;
  firstName: string;
  balance: string;
  loading: boolean;
}) {
  return (
    <section className="flex flex-col gap-6 sm:gap-8">
      {/* Saludo legible (no uppercase mini): 18-20px en mobile, 22-24px desktop */}
      <p className="text-[18px] sm:text-[22px] text-[var(--color-fg-muted)] leading-tight">
        {greeting},{' '}
        <span className="text-[var(--color-fg)] font-medium">{firstName}</span>
      </p>

      {/* Saldo: bloque dedicado, número gigante. Sin sparkline ni KPIs. */}
      <div className="flex flex-col gap-2">
        <span className="text-[16px] sm:text-[18px] text-[var(--color-fg-muted)]">
          Tu saldo
        </span>
        <BigBalance value={balance} loading={loading} />
      </div>

      {/* Acciones primarias: 2 botones grandes lado a lado en desktop,
        * apilados en mobile. Min-height 56px (Apple HIG + WCAG). */}
      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
        <Button variant="premium" size="xl" asChild className="min-h-[56px] text-[17px] sm:text-[18px] flex-1 sm:flex-none sm:min-w-[200px]">
          <Link href="/play/deposits">
            <ArrowDownToLine className="size-5" aria-hidden />
            Depositar
          </Link>
        </Button>
        <Button variant="premium-ghost" size="xl" asChild className="min-h-[56px] text-[17px] sm:text-[18px] flex-1 sm:flex-none sm:min-w-[200px]">
          <Link href="/play/withdrawals">
            <ArrowUpToLine className="size-5" aria-hidden />
            Retirar
          </Link>
        </Button>
      </div>
    </section>
  );
}

/**
 * Número del saldo, grande y legible. Counter animation suave on-mount
 * (no es distractor para gente grande — el número solo cuenta arriba
 * una vez y queda quieto).
 */
function BigBalance({ value, loading }: { value: string; loading: boolean }) {
  const numeric = Number(value) || 0;
  const animated = useAnimatedNumber(numeric, 800);

  if (loading) {
    return (
      <span className="font-display text-[3.5rem] sm:text-[5rem] leading-none tracking-tight text-[var(--color-fg-subtle)] tabular-nums">
        —
      </span>
    );
  }
  return (
    <div className="flex items-baseline gap-3 flex-wrap">
      <span className="font-display text-[3.5rem] sm:text-[5rem] leading-none tracking-tight text-[var(--color-fg)] tabular-nums">
        {animated.toLocaleString('es-AR', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
      </span>
      <span className="text-[16px] sm:text-[18px] text-[var(--color-fg-muted)] font-medium">
        fichas
      </span>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Sección Jugar — el bloque principal
// ──────────────────────────────────────────────────────────────────────

function GamesSection({
  games,
  loading,
}: {
  games: PlayerGame[];
  loading: boolean;
}) {
  return (
    <section className="flex flex-col gap-5 sm:gap-6">
      <div className="flex items-end justify-between gap-3">
        <h2 className="font-display text-[26px] sm:text-[32px] leading-tight tracking-tight text-[var(--color-fg)]">
          Jugar
        </h2>
      </div>

      {loading ? (
        <GamesGridSkeleton />
      ) : games.length === 0 ? (
        <EmptyGames />
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {games.map((g) => (
            <HomeGameCard key={g.id} game={g} />
          ))}
        </div>
      )}

      <div className="pt-2">
        <Button
          variant="premium-ghost"
          size="xl"
          asChild
          className="min-h-[56px] text-[17px] sm:text-[18px] w-full sm:w-auto"
        >
          <Link href="/play/lobby">
            Ver todos los juegos
            <ArrowRight className="size-5" aria-hidden />
          </Link>
        </Button>
      </div>
    </section>
  );
}

function GamesGridSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4" aria-hidden>
      {Array.from({ length: HOME_GAMES_COUNT }).map((_, i) => (
        <div
          key={i}
          className="card-premium rounded-[var(--radius-lg)] p-2 flex flex-col gap-3"
        >
          <div className="w-full aspect-[4/3] rounded-[var(--radius)] bg-[var(--color-bg-subtle)] animate-shimmer" />
          <div className="h-5 w-3/4 bg-[var(--color-bg-subtle)] animate-shimmer rounded-sm mx-1 mb-1" />
        </div>
      ))}
    </div>
  );
}

function EmptyGames() {
  return (
    <div className="card-premium rounded-[var(--radius-lg)] p-8 text-center">
      <p className="text-[17px] text-[var(--color-fg)] mb-2">
        Todavía no hay juegos disponibles.
      </p>
      <p className="text-[15px] text-[var(--color-fg-muted)]">
        Vas a poder jugar cuando el administrador active el primer juego.
      </p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Más opciones — atajos a las secciones secundarias
// ──────────────────────────────────────────────────────────────────────

function MoreOptionsSection() {
  return (
    <section className="flex flex-col gap-4 sm:gap-5">
      <h2 className="font-display text-[22px] sm:text-[26px] leading-tight tracking-tight text-[var(--color-fg)]">
        Más opciones
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <OptionCard
          href="/play/bonuses"
          icon={Gift}
          title="Mis bonos"
          subtitle="Promociones y regalos disponibles"
        />
        <OptionCard
          href="/play/wallet"
          icon={Receipt}
          title="Mis movimientos"
          subtitle="Historial de depósitos, retiros y jugadas"
        />
      </div>
    </section>
  );
}

function OptionCard({
  href,
  icon: Icon,
  title,
  subtitle,
}: {
  href: string;
  icon: typeof Gift;
  title: string;
  subtitle: string;
}) {
  return (
    <Link
      href={href}
      className="card-premium rounded-[var(--radius-lg)] p-5 sm:p-6 flex items-center gap-4 transition-colors hover:border-[var(--color-accent)] active:scale-[0.99]"
    >
      <div
        className="size-12 sm:size-14 shrink-0 rounded-full flex items-center justify-center bg-[var(--color-accent-subtle)] border border-[var(--color-accent-border)]"
        aria-hidden
      >
        <Icon className="size-6 sm:size-7 text-[var(--color-accent-text)]" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[17px] sm:text-[18px] font-medium text-[var(--color-fg)] leading-tight">
          {title}
        </p>
        <p className="text-[14px] sm:text-[15px] text-[var(--color-fg-muted)] mt-1 leading-snug">
          {subtitle}
        </p>
      </div>
      <ArrowRight
        className="size-5 text-[var(--color-fg-muted)] shrink-0"
        aria-hidden
      />
    </Link>
  );
}
