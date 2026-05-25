/**
 * /play — dashboard del jugador (Sprint 54 rediseño "modo simple").
 *
 * Rediseño orientado a usuarios mayores y/o poco familiarizados con UI
 * moderna. El objetivo del pedido del dueño: "que sea fácil de interactuar
 * y que los juegos estén visibles".
 *
 * Composición:
 *
 *   1. Hero (saludo + saldo + 2 botones grandes) + Panel "Tu día"
 *      a la derecha en desktop / debajo en mobile. El panel agrupa:
 *      racha actual, bonos activos y ruleta diaria (solo si aplica).
 *      Si NO hay ningún item con info real, el hero usa toda la fila
 *      sin dejar columna vacía.
 *
 *   2. Jugar — título grande + grid de 6 juegos (3 cols desktop, 2 mobile).
 *      Cards medianas (HomeGameCard, no la del lobby): thumb + nombre
 *      legible 16px. Sin tilt 3D, sin shimmer. CTA secundario "Ver todos
 *      los juegos" debajo del grid.
 *
 *   3. Más opciones — 2 botones grandes (Bonos · Mis movimientos)
 *      como tarjetas.
 *
 * Comparado con el dashboard anterior (Sprint 51.16):
 *   - REMOVIDO: sparkline, KpiRow, MissionsStrip (con scroll horizontal),
 *     VipTierCard, LeagueInlineCard, Recent activity list, 4 quick
 *     action tiles.
 *   - REEMPLAZADO: ese stack de 7 secciones + 6 widgets flotantes por
 *     este layout de 3 bloques + panel "Tu día" condicional.
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
  Flame,
  Gift,
  Receipt,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';
import { HomeGameCard } from '@/components/player/home-game-card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth-context';
import { useMyBonuses } from '@/lib/hooks/use-bonuses';
import { useActiveGames, type PlayerGame } from '@/lib/hooks/use-games';
import { useAnimatedNumber } from '@/lib/hooks/use-animated-number';
import {
  useActivePromotions,
  useMyStreak,
  useMyWheelRewards,
  todayUtcAnchor,
} from '@/lib/hooks/use-player-promotions';
import { useMyWallet } from '@/lib/hooks/use-wallet';
import { cn } from '@/lib/cn';

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

  // Datos del panel "Tu día". Siempre renderiza — si no hay items
  // reales (racha/bonos/ruleta) cae a un estado "al día" con CTA.
  // Esto evita el problema "home vacía en desktop" cuando el usuario
  // no tiene promos activas.
  const dailyItems = useDailyPanelItems();

  const loadingGames = featured.isLoading || all.isLoading;
  const firstName =
    user?.displayName?.split(' ')[0] ?? user?.username ?? 'jugador';
  const greeting = greetingFor(new Date());

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-8 sm:py-12 flex flex-col gap-12 sm:gap-16">
      <HeroCard
        greeting={greeting}
        firstName={firstName}
        balance={wallet.data?.balance ?? '0'}
        loading={wallet.isLoading}
        dailyItems={dailyItems}
      />
      <GamesSection games={games} loading={loadingGames} />
      <MoreOptionsSection />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Hero card — wrapper único que envuelve hero + panel "Tu día"
// ──────────────────────────────────────────────────────────────────────

/**
 * Una sola card grande con imagen de fondo + glow accent que contiene
 * ambas columnas (hero + panel). Sprint 54.1 — feedback "lo siento
 * vacío": al tener hero y panel en la misma card grande, el bloque
 * superior se ve macizo y unificado en vez de "2 piezas sueltas".
 *
 * Layout interno:
 *   - Desktop (lg+): 2 columnas con divider vertical (border-r).
 *   - Mobile: 1 columna, panel debajo del hero con divider horizontal
 *     (border-t).
 *
 * Background:
 *   - `welcome.webp` (con fallback avif) al 25% opacity + mix-blend
 *     luminosity para que se sienta como textura, no como foto.
 *   - Overlay con gradient diagonal oscuro (95% → 60% opacity de bg)
 *     para que el texto siempre tenga contraste WCAG sobre la imagen.
 *   - Glow accent radial top-right (suave, mismo color que --accent-glow).
 */
function HeroCard({
  greeting,
  firstName,
  balance,
  loading,
  dailyItems,
}: {
  greeting: string;
  firstName: string;
  balance: string;
  loading: boolean;
  dailyItems: DailyItem[];
}) {
  return (
    <div className="relative overflow-hidden card-premium rounded-[var(--radius-xl)]">
      {/* Background image — opacidad baja, textura sutil. */}
      <picture aria-hidden>
        <source srcSet="/hero/welcome.avif" type="image/avif" />
        <source srcSet="/hero/welcome.webp" type="image/webp" />
        {}
        <img
          src="/hero/welcome.webp"
          alt=""
          className="absolute inset-0 w-full h-full object-cover opacity-25 mix-blend-luminosity pointer-events-none"
        />
      </picture>

      {/* Overlay oscuro — asegura legibilidad del texto sobre la imagen */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'linear-gradient(135deg, rgba(18,18,18,0.95) 0%, rgba(18,18,18,0.75) 60%, rgba(18,18,18,0.55) 100%)',
        }}
      />

      {/* Glow accent radial top-right — peso visual sin contenido */}
      <div
        aria-hidden
        className="absolute -inset-x-12 -top-12 h-48 sm:h-64 opacity-30 blur-3xl pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at 75% center, var(--color-accent-glow) 0%, transparent 65%)',
        }}
      />

      {/* Contenido: grid 2-col en desktop, stack en mobile */}
      <div className="relative grid grid-cols-1 lg:grid-cols-[1fr_minmax(280px,340px)] items-stretch">
        <HeroContent
          greeting={greeting}
          firstName={firstName}
          balance={balance}
          loading={loading}
        />
        <DailyPanelContent items={dailyItems} />
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Hero content — saludo + saldo + acciones primarias (sin card propia,
// vive dentro de HeroCard)
// ──────────────────────────────────────────────────────────────────────

function HeroContent({
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
    <section className="flex flex-col gap-6 sm:gap-8 p-6 sm:p-10 lg:border-r border-[var(--color-border)]">
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

// ──────────────────────────────────────────────────────────────────────
// Panel "Tu día" — sidebar derecho en desktop, debajo del hero en mobile
// ──────────────────────────────────────────────────────────────────────

/**
 * Cada item del panel es:
 *   - Una pieza de info CONCRETA (racha activa, bonos disponibles,
 *     ruleta lista). No info de marketing ni "gamification fluff".
 *   - Tap-target grande → navega a la página correspondiente.
 *
 * El criterio para que un item aparezca:
 *   - Racha: existe la promo activa Y el usuario tiene streak > 0 ó la
 *     puede reclamar hoy. Si nunca interactuó, no aparece (no abruma).
 *   - Bonos: tiene ≥1 bono active/pending. Si no, no aparece.
 *   - Ruleta diaria: existe la promo activa. Si ya giró hoy, aparece
 *     en estado "ya giraste" pero igual visible (vibe "vuelta mañana").
 *
 * Si los 3 items están vacíos, `useDailyPanelItems` devuelve `[]` y el
 * componente padre decide no renderizar el panel — el hero ocupa toda
 * la fila.
 */
interface DailyItem {
  key: string;
  icon: LucideIcon;
  accent: string;
  title: string;
  subtitle: string;
  href: string;
  done?: boolean;
}

function useDailyPanelItems(): DailyItem[] {
  const wheels = useActivePromotions('daily_wheel');
  const streaks = useActivePromotions('login_streak');
  const wheel = wheels.data?.data[0];
  const streak = streaks.data?.data[0];

  const todaysSpins = useMyWheelRewards(wheel?.id ?? null);
  const todayAnchor = todayUtcAnchor();
  const spunToday =
    todaysSpins.data?.data.some(
      (r) =>
        (r.metadata as { dayAnchor?: string } | null)?.dayAnchor ===
        todayAnchor,
    ) ?? false;

  const streakInfo = useMyStreak(streak?.id ?? null);
  const currentStreakDay = streakInfo.data?.progress?.streak ?? 0;
  const lastClaimDay = streakInfo.data?.progress?.lastClaimDay;
  const streakClaimedToday = lastClaimDay === todayAnchor;

  const myBonuses = useMyBonuses({
    statuses: ['active', 'pending'],
    limit: 5,
  });
  const activeBonusCount = myBonuses.data?.total ?? 0;

  const items: DailyItem[] = [];

  // Racha: solo si la promo existe Y el usuario tiene streak > 0
  // (jugador completamente nuevo no debe ver "Día 0").
  if (streak && currentStreakDay > 0) {
    items.push({
      key: 'streak',
      icon: Flame,
      accent: '#FF6B35',
      title: `Día ${currentStreakDay} de racha`,
      subtitle: streakClaimedToday
        ? 'Volvé mañana para el próximo'
        : 'Reclamá el premio de hoy',
      href: '/play/streak',
      done: streakClaimedToday,
    });
  }

  // Bonos: solo si tiene al menos uno.
  if (activeBonusCount > 0) {
    items.push({
      key: 'bonuses',
      icon: Gift,
      accent: 'var(--color-accent)',
      title:
        activeBonusCount === 1
          ? '1 bono activo'
          : `${activeBonusCount} bonos activos`,
      subtitle: 'Tocá para ver detalle',
      href: '/play/bonuses',
    });
  }

  // Ruleta diaria: si existe la promo siempre la mostramos —
  // un giro diario es info útil aunque ya giró (vibe "vuelve mañana").
  if (wheel) {
    items.push({
      key: 'wheel',
      icon: Sparkles,
      accent: '#FFD700',
      title: spunToday ? 'Ruleta de hoy lista' : 'Ruleta diaria disponible',
      subtitle: spunToday ? 'Ya giraste · volvé mañana' : 'Tap para girar',
      href: '/play/wheel',
      done: spunToday,
    });
  }

  return items;
}

/**
 * Sprint 54.1: ahora vive DENTRO de HeroCard. Eliminado card-premium
 * y glow propios (los aporta el wrapper). Border-top en mobile (separa
 * del hero apilado), no border en desktop (el border-r del hero ya
 * dibuja el divider).
 */
function DailyPanelContent({ items }: { items: DailyItem[] }) {
  return (
    <aside
      className="flex flex-col gap-1 p-6 sm:p-8 border-t lg:border-t-0 border-[var(--color-border)]"
      aria-label="Resumen de tu día"
    >
      <h2 className="font-display text-[20px] sm:text-[22px] leading-tight tracking-tight text-[var(--color-fg)] mb-2">
        Tu día
      </h2>
      {items.length > 0 ? (
        <ul className="flex flex-col divide-y divide-[var(--color-border)] -mx-2">
          {items.map((item) => (
            <li key={item.key}>
              <DailyItemRow item={item} />
            </li>
          ))}
        </ul>
      ) : (
        <DailyPanelEmpty />
      )}
    </aside>
  );
}

/**
 * Estado del panel cuando no hay racha activa ni bonos ni ruleta.
 * En vez de panel vacío (que volvería al problema "se siente vacío"),
 * mostramos un mensaje cálido + 1 CTA útil. No es "fluff de marketing":
 * es información honesta — el usuario está al día, y le mostramos qué
 * podría activar si quiere.
 */
function DailyPanelEmpty() {
  return (
    <div className="flex flex-col items-start gap-3 py-2">
      <div
        className="size-12 rounded-full flex items-center justify-center"
        style={{
          background:
            'linear-gradient(135deg, var(--color-accent-subtle), transparent)',
          border: '1px solid var(--color-accent-border)',
        }}
        aria-hidden
      >
        <Sparkles className="size-5 text-[var(--color-accent-text)]" />
      </div>
      <div>
        <p className="text-[17px] sm:text-[18px] font-medium text-[var(--color-fg)] leading-tight">
          Estás al día
        </p>
        <p className="text-[14px] sm:text-[15px] text-[var(--color-fg-muted)] mt-1 leading-snug">
          Cuando tengas una racha activa, un bono o un giro disponible,
          va a aparecer acá.
        </p>
      </div>
      <Link
        href="/play/bonuses"
        className="mt-1 inline-flex items-center gap-2 text-[15px] font-medium text-[var(--color-accent-text)] hover:underline"
      >
        Ver promociones disponibles
        <ArrowRight className="size-4" aria-hidden />
      </Link>
    </div>
  );
}

function DailyItemRow({ item }: { item: DailyItem }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        'flex items-center gap-3 px-2 py-3.5',
        'transition-colors hover:bg-[var(--color-bg-subtle)]/50 active:scale-[0.99]',
        'rounded-[var(--radius)]',
      )}
    >
      <div
        className={cn(
          'size-11 shrink-0 rounded-full flex items-center justify-center border',
          item.done && 'opacity-50',
        )}
        style={{
          background: `linear-gradient(135deg, ${item.accent}25, ${item.accent}08)`,
          borderColor: `${item.accent}50`,
        }}
        aria-hidden
      >
        <Icon className="size-5" style={{ color: item.accent }} />
      </div>
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            'text-[16px] sm:text-[17px] font-medium leading-tight',
            item.done
              ? 'text-[var(--color-fg-muted)]'
              : 'text-[var(--color-fg)]',
          )}
        >
          {item.title}
        </p>
        <p className="text-[13px] sm:text-[14px] text-[var(--color-fg-muted)] mt-0.5 leading-snug">
          {item.subtitle}
        </p>
      </div>
      <ArrowRight
        className="size-4 text-[var(--color-fg-subtle)] shrink-0"
        aria-hidden
      />
    </Link>
  );
}
