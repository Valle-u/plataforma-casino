/**
 * /play — dashboard del jugador (Sprint 51.11 rediseño mobile-first).
 *
 * Composición:
 *   1. Greeting + hero balance grande con counter animation on-load.
 *   2. **Misiones del día** — strip horizontal (scroll en mobile):
 *      - Ruleta diaria (estado: lista / ya girada hoy).
 *      - Login streak (día N de M con progreso).
 *      - Bonus activo más cercano a complete (si hay).
 *      Cada card es CTA visual + tap → ruta correspondiente.
 *   3. Quick actions: grid 2x2 mobile, 4 cols desktop.
 *   4. Actividad reciente — últimas 5 tx, compact list mobile.
 *
 * Dopamine drivers:
 *   - Hero balance con counter animation (lib `useAnimatedNumber`).
 *   - Glow pulse del balance card al hacer mount.
 *   - Strip de misiones siempre arriba — recordatorio constante de
 *     "tenés cosas para hacer y ganar".
 *   - Floating league widget (en layout, no acá) refuerza retención.
 */

'use client';

import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpToLine,
  Coins,
  Dice5,
  Flame,
  Gift,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wallet as WalletIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type ComponentType, type CSSProperties, type SVGProps } from 'react';
import { LeagueInlineCard } from '@/components/player/league-inline-card';
import { useAnimatedNumber } from '@/lib/hooks/use-animated-number';
import { useAuth } from '@/lib/auth-context';
import { useMyBonuses } from '@/lib/hooks/use-bonuses';
import {
  useActivePromotions,
  useMyStreak,
  useMyWheelRewards,
  todayUtcAnchor,
} from '@/lib/hooks/use-player-promotions';
import {
  useMyTransactions,
  useMyWallet,
  useMyWalletStats,
} from '@/lib/hooks/use-wallet';
import { cn } from '@/lib/cn';

export default function PlayDashboardPage() {
  const { user } = useAuth();
  const wallet = useMyWallet();
  const stats7d = useMyWalletStats(7);
  const stats1d = useMyWalletStats(1);
  const txs = useMyTransactions(5, 0);
  const myBonuses = useMyBonuses({
    statuses: ['active', 'pending'],
    limit: 5,
  });

  // Streak para mostrar día actual en el header (refuerza retención).
  const streakPromos = useActivePromotions('login_streak');
  const streak = streakPromos.data?.data[0];
  const streakInfo = useMyStreak(streak?.id ?? null);
  const currentStreakDay = streakInfo.data?.progress?.streak ?? 0;

  const balance = wallet.data?.balance;
  const lockedBalance = wallet.data?.lockedBalance;
  const hasLocked = lockedBalance && Number(lockedBalance) > 0;

  const firstName =
    user?.displayName?.split(' ')[0] ?? user?.username ?? 'jugador';
  const greeting = greetingFor(new Date());

  return (
    // px-4 sm:px-6 para mobile-first (16px en mobile vs 24px desktop).
    <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col gap-6 sm:gap-10">
      {/* Greeting + hero balance — bloque visual de impacto.
        * Sprint 51.16: saludo dinámico por franja horaria + chip de racha
        * si tiene una activa. La idea es que el player sienta que la app
        * "lo conoce" desde la primera línea. */}
      <header
        className="flex flex-col gap-2 animate-fade-up"
        style={{ animationFillMode: 'both' }}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] sm:text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium">
            {greeting}
          </span>
          {currentStreakDay > 0 && (
            <span className="inline-flex items-center gap-1 px-2 h-5 text-[10px] uppercase tracking-[0.1em] font-mono font-medium bg-[#FF6B35]/15 text-[#FF6B35] border border-[#FF6B35]/40">
              <Flame className="size-2.5" />
              Día {currentStreakDay}
            </span>
          )}
        </div>
        <h1 className="font-display text-3xl sm:text-[3rem] leading-none tracking-tight">
          Hola, {firstName}
        </h1>
      </header>

      {/* Hero balance — animated counter, image background, KPI row.
        * Sprint 51.16: ahora el bloque del saldo trae imagen de fondo
        * (welcome.png) con overlay, y debajo del número una fila de KPIs
        * en vivo (ganancia neta hoy, ganancia 7d, bonos activos, hold). */}
      <section
        className="relative animate-fade-up"
        style={{ animationDelay: '80ms', animationFillMode: 'both' }}
      >
        <div className="relative overflow-hidden border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)]">
          {/* Imagen de fondo decorativa — opacity bajísima, sólo "textura". */}
          <picture aria-hidden>
            <source srcSet="/hero/welcome.avif" type="image/avif" />
            <source srcSet="/hero/welcome.webp" type="image/webp" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/hero/welcome.webp"
              alt=""
              className="absolute inset-0 w-full h-full object-cover opacity-30 mix-blend-luminosity"
            />
          </picture>
          {/* Gradient overlay — ilegibilidad del fondo, texto vivo. */}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(135deg, rgba(18,18,18,0.95) 0%, rgba(18,18,18,0.75) 60%, rgba(18,18,18,0.55) 100%)',
            }}
          />
          {/* Glow accent arriba a la derecha (donde está la imagen menos oscura) */}
          <div
            aria-hidden
            className="absolute -inset-x-12 -top-12 h-48 sm:h-64 opacity-30 blur-3xl pointer-events-none"
            style={{
              background:
                'radial-gradient(ellipse at 70% center, var(--color-accent-glow) 0%, transparent 65%)',
            }}
          />

          <div className="relative p-5 sm:p-10 flex flex-col gap-4 sm:gap-6">
            <div className="flex items-center gap-2 text-[10px] sm:text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)]">
              <Coins className="size-3 text-[var(--color-accent-text)]" />
              Tu saldo
              {wallet.isFetching && !wallet.isLoading && (
                <span
                  className="size-1.5 rounded-full bg-[var(--color-accent-text)] animate-pulse ml-1"
                  title="Actualizando saldo…"
                  aria-label="Actualizando saldo"
                />
              )}
            </div>
            <AnimatedBalance
              value={balance ?? '0'}
              loading={wallet.isLoading}
            />
            {hasLocked && (
              <div className="flex items-center gap-2 text-[11px] sm:text-[12px] text-[var(--color-fg-muted)]">
                <span className="font-mono tabular-nums">
                  {Number(lockedBalance).toLocaleString('es-AR')}
                </span>
                <span className="uppercase tracking-[0.1em] text-[10px]">
                  en hold (retiros pendientes)
                </span>
              </div>
            )}

            {/* KPI row — chips ganados hoy / 7d / bonos activos / hold.
              * Si stats no cargó, no muestra nada (no rompe layout). */}
            <KpiRow
              net1d={stats1d.data?.netChange}
              net7d={stats7d.data?.netChange}
              activeBonuses={myBonuses.data?.total}
              streakDay={currentStreakDay}
            />

            {/* Botones tap-friendly: min-height 44px (a11y mobile) */}
            <div className="flex items-center gap-2 sm:gap-3 pt-1 sm:pt-2 flex-wrap">
              <Link href="/play/deposits" className="inline-block">
                <button
                  type="button"
                  className="inline-flex items-center gap-2 px-4 h-11 sm:h-10 bg-[var(--color-accent)] text-[var(--color-accent-fg)] hover:bg-[var(--color-accent-hover)] active:scale-95 transition-all text-[13px] font-medium tracking-tight"
                >
                  <ArrowDownToLine className="size-3.5" />
                  Depositar
                </button>
              </Link>
              <Link href="/play/wallet" className="inline-block">
                <button
                  type="button"
                  className="inline-flex items-center gap-2 px-4 h-11 sm:h-10 bg-[var(--color-bg-subtle)] border border-[var(--color-border)] text-[var(--color-fg)] hover:border-[var(--color-border-strong)] active:scale-95 transition-all text-[13px] font-medium tracking-tight"
                >
                  Wallet
                  <ArrowRight className="size-3.5" />
                </button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Misiones del día — strip horizontal con scroll mobile */}
      <MissionsStrip />

      {/* Sprint 51.17: liga inline — social proof + dopamine de retención */}
      <LeagueInlineCard />

      {/* Quick actions: ahora con backgrounds de imagen + accent per-card.
        * Sprint 51.16 — antes eran tiles planos grises, ahora cada acceso
        * tiene "personalidad" visual con la imagen hero correspondiente. */}
      <section
        className="flex flex-col gap-3 animate-fade-up"
        style={{ animationDelay: '160ms', animationFillMode: 'both' }}
      >
        <h2 className="text-[10px] sm:text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-medium">
          Accesos rápidos
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
          <QuickAction
            href="/play/lobby"
            icon={Dice5}
            label="Casino"
            hint="Ver juegos"
            image="slots"
            accent="#FFD700"
          />
          <QuickAction
            href="/play/deposits"
            icon={ArrowDownToLine}
            label="Depositar"
            hint="Cargar saldo"
            image="bonus"
            accent="var(--color-accent)"
          />
          <QuickAction
            href="/play/bonuses"
            icon={Gift}
            label="Bonos"
            hint={
              myBonuses.data?.total
                ? `${myBonuses.data.total} activo${myBonuses.data.total === 1 ? '' : 's'}`
                : 'Ver disponibles'
            }
            image="cards"
            accent="#FFD700"
          />
          <QuickAction
            href="/play/withdrawals"
            icon={ArrowUpToLine}
            label="Retirar"
            hint="Solicitar cobro"
            image="league"
            accent="#4F9BFF"
          />
        </div>
      </section>

      {/* Recent activity */}
      <section className="flex flex-col gap-3 animate-fade-up">
        <div className="flex items-end justify-between">
          <h2 className="text-[10px] sm:text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-medium">
            Actividad reciente
          </h2>
          <Link
            href="/play/wallet"
            className="text-[10px] sm:text-[11px] text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] uppercase tracking-[0.08em] transition-colors"
          >
            Ver todo →
          </Link>
        </div>
        <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
          {txs.isLoading ? (
            <div className="px-4 py-3 text-[12px] text-[var(--color-fg-subtle)] italic">
              Cargando…
            </div>
          ) : !txs.data || txs.data.data.length === 0 ? (
            <div className="px-4 py-3 text-[12px] text-[var(--color-fg-subtle)] italic">
              Sin movimientos todavía.
            </div>
          ) : (
            txs.data.data.map((tx) => {
              const isCredit = isCreditType(tx.type);
              const sign = isCredit ? '+' : '−';
              return (
                <div
                  key={tx.id}
                  className="grid grid-cols-[auto_1fr_auto] gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 items-center"
                >
                  <span
                    className={cn(
                      'text-[10px] uppercase tracking-[0.08em] font-mono w-20 sm:w-24 truncate',
                      isCredit
                        ? 'text-[var(--color-success)]'
                        : 'text-[var(--color-fg-muted)]',
                    )}
                  >
                    {tx.type}
                  </span>
                  <span className="text-[11px] text-[var(--color-fg-subtle)] font-mono truncate">
                    {tx.reason ?? '—'}
                  </span>
                  <span
                    className={cn(
                      'font-mono tabular-nums text-[13px]',
                      isCredit
                        ? 'text-[var(--color-success)]'
                        : 'text-[var(--color-fg)]',
                    )}
                  >
                    {sign}
                    {Number(tx.amount).toLocaleString('es-AR')}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Animated balance — counter animation on mount + change
// ──────────────────────────────────────────────────────────────────────

function AnimatedBalance({
  value,
  loading,
}: {
  value: string;
  loading: boolean;
}) {
  const numericValue = Number(value) || 0;
  const animated = useAnimatedNumber(numericValue, 1200);

  if (loading) {
    return (
      <div className="flex items-baseline gap-3 flex-wrap min-h-[3.5rem] sm:min-h-[5rem]">
        <span className="font-display text-[3rem] sm:text-[5rem] leading-none tracking-tight text-[var(--color-fg-subtle)]">
          —
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-baseline gap-2 sm:gap-3 flex-wrap">
      <span className="font-display text-[3rem] sm:text-[5rem] leading-none tracking-tight tabular-nums text-[var(--color-fg)]">
        {animated.toLocaleString('es-AR', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
      </span>
      <span className="font-mono text-xs sm:text-sm uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
        CHIPS
      </span>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Misiones strip — dopamine prime (Sprint 51.18 upgrade)
// ──────────────────────────────────────────────────────────────────────

function MissionsStrip() {
  const wheels = useActivePromotions('daily_wheel');
  const streaks = useActivePromotions('login_streak');
  const wheel = wheels.data?.data[0];
  const streak = streaks.data?.data[0];

  const todaysSpins = useMyWheelRewards(wheel?.id ?? null);
  const todayAnchor = todayUtcAnchor();
  const spunToday = todaysSpins.data?.data.some(
    (r) =>
      (r.metadata as { dayAnchor?: string } | null)?.dayAnchor === todayAnchor,
  ) ?? false;

  const streakInfo = useMyStreak(streak?.id ?? null);
  const currentStreakDay = streakInfo.data?.progress?.streak ?? 0;
  const lastClaimDay = streakInfo.data?.progress?.lastClaimDay;
  const streakClaimedToday = lastClaimDay === todayAnchor;
  const totalDays = Array.isArray(
    (streak?.config as { prizes?: unknown[] } | undefined)?.prizes,
  )
    ? (streak!.config as { prizes: unknown[] }).prizes.length
    : 7;

  const myBonuses = useMyBonuses({
    statuses: ['active', 'pending'],
    limit: 5,
  });
  const activeBonusCount = myBonuses.data?.total ?? 0;

  // Best prize visible (best-effort parse de wheel.config.prizes / streak.config.prizes).
  // Cast a Record<string, unknown> porque los parsers son defensivos y los
  // tipos del backend son específicos (WheelConfig / StreakConfig).
  const wheelMaxPrize = wheel
    ? parseMaxPrize(wheel.config as unknown as Record<string, unknown>)
    : null;
  const streakMaxPrize = streak
    ? parseMaxStreakPrize(
        streak.config as unknown as Record<string, unknown>,
        currentStreakDay,
      )
    : null;

  const readyCount =
    (wheel && !spunToday ? 1 : 0) +
    (streak && !streakClaimedToday ? 1 : 0);

  return (
    <section className="flex flex-col gap-3 animate-fade-up">
      <div className="flex items-center justify-between">
        <h2 className="text-[10px] sm:text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-medium flex items-center gap-1.5">
          <Sparkles className="size-3 text-[var(--color-accent-text)]" />
          Misiones del día
          {readyCount > 0 && (
            <span className="inline-flex items-center gap-1 px-1.5 h-4 bg-[#FFD700] text-black text-[9px] font-mono font-bold tabular-nums tracking-tight">
              {readyCount} listas
            </span>
          )}
        </h2>
        <ResetCountdown />
      </div>
      {/* Scroll horizontal en mobile (snap), grid en desktop */}
      <div className="flex md:grid md:grid-cols-3 gap-3 overflow-x-auto md:overflow-visible -mx-4 sm:-mx-6 md:mx-0 px-4 sm:px-6 md:px-0 pb-2 md:pb-0 snap-x snap-mandatory md:snap-none">
        {wheel && (
          <MissionCard
            href="/play/wheel"
            icon={Sparkles}
            accent="#FFD700"
            title="Ruleta diaria"
            state={spunToday ? 'done' : 'ready'}
            stateLabel={
              spunToday ? 'Ya giraste hoy' : '¡Tu giro está esperando!'
            }
            rewardLabel={
              wheelMaxPrize
                ? `Hasta ${formatChipsShort(wheelMaxPrize)} chips`
                : 'Premio diario'
            }
            cta={spunToday ? 'Volvé mañana' : 'Girar ahora'}
          />
        )}
        {streak && (
          <MissionCard
            href="/play/streak"
            icon={Flame}
            accent="#FF6B35"
            title="Racha de login"
            state={
              streakClaimedToday
                ? 'done'
                : currentStreakDay > 0
                  ? 'ready'
                  : 'ready' // Día 1 también es ready (es claimable)
            }
            stateLabel={
              streakClaimedToday
                ? `Día ${currentStreakDay} reclamado · seguí mañana`
                : currentStreakDay > 0
                  ? `Día ${currentStreakDay + 1} de ${totalDays} disponible`
                  : `Empezá hoy · día 1 de ${totalDays}`
            }
            rewardLabel={
              streakMaxPrize
                ? `Hoy: ${formatChipsShort(streakMaxPrize)} chips`
                : `${totalDays} días de premios`
            }
            progress={currentStreakDay / Math.max(1, totalDays)}
            cta={streakClaimedToday ? 'Volvé mañana' : 'Reclamar'}
          />
        )}
        <MissionCard
          href="/play/bonuses"
          icon={Gift}
          accent="var(--color-accent)"
          title="Bonos"
          state={activeBonusCount > 0 ? 'ready' : 'info'}
          stateLabel={
            activeBonusCount > 0
              ? `${activeBonusCount} ${activeBonusCount === 1 ? 'bonus activo' : 'bonos activos'} esperándote`
              : 'Ver bonos disponibles'
          }
          rewardLabel={
            activeBonusCount > 0
              ? 'Sumá chips extra'
              : 'Pedile uno a tu cajero'
          }
          cta="Abrir"
        />
      </div>
    </section>
  );
}

/**
 * Chip "Resetea en HH:MM" — hasta el próximo UTC 00:00 (cuando rueda
 * diaria y streak resetean). Refresca cada 60s.
 */
function ResetCountdown() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  const today = new Date(now);
  const tomorrow = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  );
  const remaining = tomorrow - now;
  if (remaining <= 0) return null;
  const hours = Math.floor(remaining / (60 * 60 * 1000));
  const mins = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
  return (
    <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] font-mono flex items-center gap-1">
      Resetea en {hours}h {mins.toString().padStart(2, '0')}m
    </span>
  );
}

interface MissionCardProps {
  href: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  accent: string;
  title: string;
  state: 'ready' | 'done' | 'idle' | 'info';
  stateLabel: string;
  /** Texto breve de "qué ganás" — visual prominente, dopamine. */
  rewardLabel: string;
  cta: string;
  progress?: number; // 0..1
}

/**
 * MissionCard — Sprint 51.18.
 *
 * Antes era plana: icon + title + label + cta. Ahora suma:
 *   - `rewardLabel` con el premio visible (chips dorados, sumá retención).
 *   - `accent` por carta (gold/orange/red), no todos del mismo color.
 *   - Estado "ready" levanta border + glow accent + pulse del dot.
 *   - Estado "done" se pone sutil + checkmark.
 *   - Background gradient sutil con el accent en hover.
 */
function MissionCard({
  href,
  icon: Icon,
  accent,
  title,
  state,
  stateLabel,
  rewardLabel,
  cta,
  progress,
}: MissionCardProps) {
  const isDone = state === 'done';
  const isReady = state === 'ready';
  return (
    <Link
      href={href}
      className={cn(
        'group relative shrink-0 w-[280px] md:w-auto snap-start overflow-hidden',
        'flex flex-col gap-3 p-4 sm:p-5',
        'bg-[var(--color-bg-elevated)] border',
        'transition-all duration-200 ease-out',
        'active:scale-[0.98]',
        isDone
          ? 'opacity-60 border-[var(--color-border)]'
          : 'border-[var(--color-border)] hover:border-[color:var(--card-accent)] hover:-translate-y-0.5',
        isReady && 'shadow-[0_0_0_1px_var(--card-accent)]',
      )}
      style={
        {
          '--card-accent': accent,
          '--card-glow': `${accent}40`,
        } as CSSProperties
      }
    >
      {/* Glow background — más fuerte en ready, sutil en hover de los otros */}
      <div
        aria-hidden
        className={cn(
          'absolute -inset-x-12 -top-12 h-32 blur-3xl pointer-events-none transition-opacity',
          isReady
            ? 'opacity-60'
            : 'opacity-0 group-hover:opacity-30',
        )}
        style={{
          background: `radial-gradient(ellipse at center, var(--card-glow) 0%, transparent 65%)`,
        }}
      />

      {/* Header: icon ring + title + ready dot */}
      <div className="relative flex items-start justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={cn(
              'relative flex items-center justify-center size-10 rounded-full shrink-0 border',
              isReady && 'animate-pulse-gold',
            )}
            style={{
              background: `linear-gradient(135deg, ${accent}30, ${accent}10)`,
              borderColor: accent,
            }}
          >
            <Icon className="size-4" style={{ color: accent }} />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[13px] font-medium text-[var(--color-fg)] truncate">
              {title}
            </span>
            <span
              className="text-[10px] uppercase tracking-[0.1em] font-mono font-medium"
              style={{ color: accent }}
            >
              {rewardLabel}
            </span>
          </div>
        </div>
        {isReady && (
          <span
            className="size-2 rounded-full animate-pulse shrink-0 mt-2"
            style={{ background: accent }}
          />
        )}
      </div>

      {/* State label */}
      <p
        className={cn(
          'relative text-[12px] leading-tight',
          isDone
            ? 'text-[var(--color-fg-subtle)]'
            : 'text-[var(--color-fg-muted)]',
        )}
      >
        {stateLabel}
      </p>

      {/* Progress bar (opcional) */}
      {progress !== undefined && (
        <div className="relative h-1.5 bg-[var(--color-bg-subtle)] overflow-hidden">
          <div
            className="h-full transition-all duration-500"
            style={{
              width: `${Math.min(100, Math.max(0, progress * 100))}%`,
              background: `linear-gradient(to right, ${accent}, ${accent}aa)`,
              boxShadow: `0 0 8px ${accent}80`,
            }}
          />
        </div>
      )}

      {/* CTA */}
      <div
        className="relative flex items-center justify-between pt-1 border-t mt-auto"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <span
          className="text-[11px] uppercase tracking-[0.08em] font-medium"
          style={{
            color: isDone ? 'var(--color-fg-subtle)' : accent,
          }}
        >
          {cta}
        </span>
        <ArrowRight
          className={cn(
            'size-3.5 transition-transform',
            !isDone && 'group-hover:translate-x-1',
          )}
          style={{
            color: isDone ? 'var(--color-fg-subtle)' : accent,
          }}
        />
      </div>
    </Link>
  );
}

// ── Parsers de premio (best-effort) ────────────────────────────────────
/**
 * Saca el max prize de un wheel config. Espera shape
 * `{ prizes: [{kind, amount, weight}] }` pero tolera variantes.
 */
function parseMaxPrize(config: Record<string, unknown>): number | null {
  if (!config || typeof config !== 'object') return null;
  const prizes = (config as { prizes?: unknown }).prizes;
  if (!Array.isArray(prizes)) return null;
  let max = 0;
  for (const p of prizes) {
    if (p && typeof p === 'object') {
      const amt = (p as { amount?: number }).amount;
      if (typeof amt === 'number' && amt > max) max = amt;
    }
  }
  return max > 0 ? max : null;
}

/**
 * Premio del próximo día de la racha. `currentDay` es el último
 * reclamado; el premio "de hoy" es el de `currentDay` (si es la primera
 * vez) o el de `currentDay + 1`. Best-effort.
 */
function parseMaxStreakPrize(
  config: Record<string, unknown>,
  currentDay: number,
): number | null {
  if (!config || typeof config !== 'object') return null;
  const prizes = (config as { prizes?: unknown }).prizes;
  if (!Array.isArray(prizes)) return null;
  const idx = Math.min(currentDay, prizes.length - 1);
  const p = prizes[idx];
  if (p && typeof p === 'object') {
    const amt = (p as { amount?: number }).amount;
    if (typeof amt === 'number') return amt;
  }
  return null;
}

function formatChipsShort(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return (n / 1_000_000).toFixed(2).replace(/\.0+$/, '') + 'M';
}

// ──────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────

/**
 * QuickAction — Sprint 51.16 rediseño visual.
 *
 * Cada tile ahora tiene:
 *   - Imagen de fondo (asset hero correspondiente) con overlay para que
 *     el texto siga siendo legible.
 *   - Border-left con el accent color de la categoría (gold/red/blue/etc).
 *   - Icono más grande en círculo accent.
 *   - Hover: glow accent + leve translate-y -2px.
 *
 * Más visual que los tiles planos grises anteriores, pero sigue compacto
 * (no compite con el hero ni con las misiones del día).
 */
function QuickAction({
  href,
  icon: Icon,
  label,
  hint,
  image,
  accent,
}: {
  href: string;
  icon: typeof WalletIcon;
  label: string;
  hint: string;
  image: string;
  accent: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'group relative overflow-hidden',
        'bg-[var(--color-bg-elevated)]',
        'border border-[var(--color-border)]',
        'p-4 sm:p-5 flex flex-col gap-2 sm:gap-3',
        'transition-all duration-300 ease-out',
        'hover:-translate-y-0.5 active:scale-[0.97] active:translate-y-0',
        'min-h-[120px] sm:min-h-[140px]',
      )}
      style={{
        borderLeftColor: accent,
        borderLeftWidth: '2px',
      }}
    >
      {/* Imagen de fondo decorativa muy sutil (mix-blend-luminosity la
        * desatura para que no compita con el texto). */}
      <picture aria-hidden>
        <source srcSet={`/hero/${image}.avif`} type="image/avif" />
        <source srcSet={`/hero/${image}.webp`} type="image/webp" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/hero/${image}.webp`}
          alt=""
          className="absolute inset-0 w-full h-full object-cover opacity-30 mix-blend-luminosity transition-opacity duration-300 group-hover:opacity-50"
        />
      </picture>
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(135deg, rgba(18,18,18,0.92) 0%, rgba(18,18,18,0.78) 60%, rgba(18,18,18,0.6) 100%)',
        }}
      />
      {/* Glow accent que aparece en hover */}
      <div
        aria-hidden
        className="absolute -inset-x-12 -bottom-12 h-32 opacity-0 group-hover:opacity-50 blur-3xl transition-opacity duration-300"
        style={{
          background: `radial-gradient(ellipse at center, ${accent} 0%, transparent 65%)`,
        }}
      />

      <div className="relative flex flex-col gap-2 sm:gap-3 h-full">
        <div
          className="size-9 sm:size-10 rounded-full flex items-center justify-center"
          style={{
            background: `linear-gradient(135deg, ${accent}30, ${accent}10)`,
            border: `1px solid ${accent}`,
          }}
        >
          <Icon className="size-4 sm:size-5" style={{ color: accent }} />
        </div>
        <div className="flex flex-col gap-0.5 mt-auto">
          <span className="text-[14px] text-[var(--color-fg)] font-medium tracking-tight">
            {label}
          </span>
          <span className="text-[11px] text-[var(--color-fg-muted)]">
            {hint}
          </span>
        </div>
      </div>
    </Link>
  );
}

/**
 * Saludo dinámico según la hora local del browser. 4 franjas:
 *   - 5-12: buen día
 *   - 12-19: buenas tardes
 *   - 19-22: buenas noches
 *   - 22-5: ¿todavía despierto? (más casual, juega con el contexto noche)
 */
function greetingFor(now: Date): string {
  const h = now.getHours();
  if (h >= 5 && h < 12) return 'Buen día';
  if (h >= 12 && h < 19) return 'Buenas tardes';
  if (h >= 19 && h < 22) return 'Buenas noches';
  return 'Bienvenido de vuelta';
}

/**
 * Fila de KPIs debajo del balance. Cada celda es chiquita pero da
 * contexto: "ganaste 1.2K hoy", "vas día 5", "tenés 2 bonos".
 *
 * El neto puede ser positivo o negativo — coloreamos verde/rojo y el
 * triángulo ↑↓ para que se lea de un vistazo. Si stats no cargó, la
 * celda muestra "—" en vez de pelar layout.
 */
function KpiRow({
  net1d,
  net7d,
  activeBonuses,
  streakDay,
}: {
  net1d: string | undefined;
  net7d: string | undefined;
  activeBonuses: number | undefined;
  streakDay: number;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-[var(--color-border)] border border-[var(--color-border)]">
      <KpiCell label="Hoy" value={formatSignedChips(net1d)} netSign={signOf(net1d)} />
      <KpiCell label="7 días" value={formatSignedChips(net7d)} netSign={signOf(net7d)} />
      <KpiCell
        label="Racha"
        value={streakDay > 0 ? `Día ${streakDay}` : '—'}
        icon={streakDay > 0 ? Flame : undefined}
        iconColor="#FF6B35"
      />
      <KpiCell
        label="Bonos"
        value={
          activeBonuses === undefined
            ? '—'
            : activeBonuses === 0
              ? 'Sin activos'
              : `${activeBonuses} activo${activeBonuses === 1 ? '' : 's'}`
        }
        icon={activeBonuses && activeBonuses > 0 ? Gift : undefined}
        iconColor="#FFD700"
      />
    </div>
  );
}

function KpiCell({
  label,
  value,
  netSign,
  icon: Icon,
  iconColor,
}: {
  label: string;
  value: string;
  netSign?: 'pos' | 'neg' | 'zero';
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  iconColor?: string;
}) {
  return (
    <div className="bg-[var(--color-bg-elevated)] px-3 sm:px-4 py-2.5 flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] font-medium">
        {label}
      </span>
      <div className="flex items-center gap-1.5">
        {netSign === 'pos' && (
          <TrendingUp className="size-3 text-[var(--color-success)]" />
        )}
        {netSign === 'neg' && (
          <TrendingDown className="size-3 text-[var(--color-accent-text)]" />
        )}
        {Icon && (
          <Icon className="size-3" style={{ color: iconColor }} />
        )}
        <span
          className={cn(
            'text-[13px] font-mono tabular-nums tracking-tight',
            netSign === 'pos' && 'text-[var(--color-success)]',
            netSign === 'neg' && 'text-[var(--color-accent-text)]',
            !netSign && 'text-[var(--color-fg)]',
          )}
        >
          {value}
        </span>
      </div>
    </div>
  );
}

function signOf(net: string | undefined): 'pos' | 'neg' | 'zero' | undefined {
  if (net === undefined) return undefined;
  const n = Number(net);
  if (Number.isNaN(n)) return undefined;
  if (n > 0) return 'pos';
  if (n < 0) return 'neg';
  return 'zero';
}

function formatSignedChips(net: string | undefined): string {
  if (net === undefined) return '—';
  const n = Number(net);
  if (Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${abs.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`;
}

function isCreditType(type: string): boolean {
  return [
    'mint',
    'load',
    'transfer_in',
    'win',
    'deposit',
    'adjustment_credit',
    'bonus_grant',
    'bonus_clear',
    'bonus_funding_revert',
    'jackpot_win',
    'promo_reward',
    'league_reward',
    'commission_payout',
    'fund_release',
  ].includes(type);
}
