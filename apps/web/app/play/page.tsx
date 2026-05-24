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
  Trophy,
  Wallet as WalletIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type ComponentType, type CSSProperties, type SVGProps } from 'react';
import { LeagueInlineCard } from '@/components/player/league-inline-card';
import { VipTierCard } from '@/components/player/vip-tier-card';
import { Button } from '@/components/ui/button';
import { Sparkline } from '@/components/ui/sparkline';
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
        <div className="relative overflow-hidden card-premium rounded-[var(--radius-xl)]">
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
            <div className="flex items-center justify-between gap-3">
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
              {/* Sprint 51.31: sparkline mini con balance evolution.
                * Data: balanceAfter de últimas N tx (sorted asc).
                * Si tx.data está vacío, no renderiza nada. */}
              {txs.data?.data && txs.data.data.length >= 2 && (
                <Sparkline
                  data={txs.data.data
                    .slice()
                    .reverse()
                    .map((tx) => Number(tx.balanceAfter))}
                  area
                  endDot
                  width={120}
                  height={32}
                  className="opacity-90"
                  ariaLabel="Evolución de tu saldo en los últimos movimientos"
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

            {/* Botones tap-friendly: min-height 44px (a11y mobile).
              * Sprint 51.36: migración a <Button variant="premium"> +
              * asChild para wrap Link. Toda la lógica de styling vive
              * en el primitive ahora. */}
            <div className="flex items-center gap-2 sm:gap-3 pt-1 sm:pt-2 flex-wrap">
              <Button variant="premium" size="xl" asChild>
                <Link href="/play/deposits">
                  <ArrowDownToLine className="size-3.5" />
                  Depositar
                </Link>
              </Button>
              <Button variant="premium-ghost" size="xl" asChild>
                <Link href="/play/wallet">
                  Wallet
                  <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Misiones del día — strip horizontal con scroll mobile */}
      <MissionsStrip />

      {/* Sprint 51.30: VIP tier card — refuerza retención mostrando perks */}
      <VipTierCard />

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

      {/* Recent activity — Sprint 51.25 rebuild premium con icons +
        * colores por tipo de tx. Antes eran filas planas, ahora cada
        * row tiene icon ring coloreado, label legible, amount con + o −
        * verde/blanco, time ago a la derecha. */}
      <section
        className="flex flex-col gap-3 animate-fade-up"
        style={{ animationDelay: '320ms', animationFillMode: 'both' }}
      >
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
        <div className="card-premium rounded-[var(--radius-lg)] overflow-hidden">
          {txs.isLoading ? (
            <RecentActivitySkeleton />
          ) : !txs.data || txs.data.data.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-[12px] text-[var(--color-fg-muted)]">
                Sin movimientos todavía.
              </p>
              <p className="text-[11px] text-[var(--color-fg-subtle)] mt-1">
                Empezá a jugar y tus tx aparecen acá.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {txs.data.data.map((tx) => (
                <ActivityRow key={tx.id} tx={tx} />
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

/**
 * ActivityRow — Sprint 51.25. Una row del Recent Activity.
 *
 * Icon ring coloreado por categoría de tx (deposit=verde, win=gold,
 * bonus=gold, withdraw=naranja, bet=accent, etc.), label legible
 * (mapped de tx.type a copy human-readable), reason como sub-line,
 * amount con sign + color, time ago a la derecha.
 */
function ActivityRow({
  tx,
}: {
  tx: { id: string; type: string; amount: string; reason: string | null; createdAt: string };
}) {
  const meta = txMeta(tx.type);
  const isCredit = meta.direction === 'in';
  const sign = isCredit ? '+' : '−';
  const Icon = meta.icon;

  return (
    <li className="px-3 sm:px-4 py-3 flex items-center gap-3 hover:bg-[var(--color-bg-subtle)]/40 transition-colors">
      <div
        className="size-9 rounded-full flex items-center justify-center shrink-0 border"
        style={{
          background: `linear-gradient(135deg, ${meta.color}25, ${meta.color}08)`,
          borderColor: `${meta.color}50`,
        }}
      >
        <Icon className="size-4" style={{ color: meta.color }} />
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="text-[13px] text-[var(--color-fg)] font-medium tracking-tight truncate">
          {meta.label}
        </span>
        <span className="text-[11px] text-[var(--color-fg-subtle)] font-mono truncate">
          {tx.reason ?? meta.fallbackHint}
        </span>
      </div>
      <div className="flex flex-col items-end gap-0.5 shrink-0">
        <span
          className={cn(
            'font-mono tabular-nums text-[14px] font-medium',
            isCredit ? 'text-[var(--color-success)]' : 'text-[var(--color-fg)]',
          )}
        >
          {sign}
          {Number(tx.amount).toLocaleString('es-AR', {
            maximumFractionDigits: 0,
          })}
        </span>
        <span className="text-[10px] text-[var(--color-fg-subtle)] font-mono">
          {timeAgo(tx.createdAt)}
        </span>
      </div>
    </li>
  );
}

function RecentActivitySkeleton() {
  return (
    <ul className="divide-y divide-[var(--color-border)]">
      {[0, 1, 2].map((i) => (
        <li
          key={i}
          className="px-3 sm:px-4 py-3 flex items-center gap-3"
          aria-hidden
        >
          <div className="size-9 rounded-full bg-[var(--color-bg-subtle)] animate-shimmer shrink-0" />
          <div className="flex-1 flex flex-col gap-1.5">
            <div className="h-3 w-2/5 bg-[var(--color-bg-subtle)] animate-shimmer rounded-sm" />
            <div className="h-2.5 w-3/5 bg-[var(--color-bg-subtle)] animate-shimmer rounded-sm" />
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <div className="h-3 w-12 bg-[var(--color-bg-subtle)] animate-shimmer rounded-sm" />
            <div className="h-2.5 w-8 bg-[var(--color-bg-subtle)] animate-shimmer rounded-sm" />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Mapeo type → ícono + color + label legible. Direction "in"/"out"
 * decide si va verde (crédito) o rojo (débito). Fallback genérico para
 * tipos no conocidos.
 */
function txMeta(type: string): {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  color: string;
  label: string;
  direction: 'in' | 'out';
  fallbackHint: string;
} {
  switch (type) {
    case 'deposit':
      return {
        icon: ArrowDownToLine,
        color: '#22c55e',
        label: 'Depósito',
        direction: 'in',
        fallbackHint: 'Carga acreditada',
      };
    case 'withdraw':
    case 'withdrawal':
      return {
        icon: ArrowUpToLine,
        color: '#f59e0b',
        label: 'Retiro',
        direction: 'out',
        fallbackHint: 'Pago solicitado',
      };
    case 'win':
    case 'jackpot_win':
      return {
        icon: Trophy,
        color: '#FFD700',
        label: type === 'jackpot_win' ? '¡Jackpot!' : 'Ganancia',
        direction: 'in',
        fallbackHint: 'Premio de juego',
      };
    case 'bet':
      return {
        icon: Dice5,
        color: 'var(--color-accent-text)',
        label: 'Apuesta',
        direction: 'out',
        fallbackHint: 'Bet colocada',
      };
    case 'bonus_grant':
    case 'promo_reward':
    case 'bonus_clear':
    case 'bonus_funding_revert':
      return {
        icon: Gift,
        color: '#FFD700',
        label: 'Bonus',
        direction: 'in',
        fallbackHint: 'Bonus acreditado',
      };
    case 'league_reward':
      return {
        icon: Trophy,
        color: '#FFD700',
        label: 'Premio de liga',
        direction: 'in',
        fallbackHint: 'Ranking semanal',
      };
    case 'load':
    case 'transfer_in':
    case 'mint':
      return {
        icon: Coins,
        color: '#22c55e',
        label: type === 'load' ? 'Carga del cajero' : 'Acreditación',
        direction: 'in',
        fallbackHint: 'Acreditación manual',
      };
    case 'unload':
    case 'transfer_out':
    case 'burn':
      return {
        icon: Coins,
        color: 'var(--color-fg-muted)',
        label: type === 'unload' ? 'Descuento del cajero' : 'Débito',
        direction: 'out',
        fallbackHint: 'Débito manual',
      };
    case 'adjustment_credit':
    case 'fund_release':
    case 'commission_payout':
      return {
        icon: TrendingUp,
        color: '#22c55e',
        label: 'Ajuste a favor',
        direction: 'in',
        fallbackHint: 'Crédito administrativo',
      };
    case 'adjustment_debit':
    case 'fund_hold':
      return {
        icon: TrendingDown,
        color: 'var(--color-accent-text)',
        label: 'Ajuste en contra',
        direction: 'out',
        fallbackHint: 'Débito administrativo',
      };
    default:
      return {
        icon: Coins,
        color: 'var(--color-fg-muted)',
        label: type,
        direction: 'out',
        fallbackHint: 'Movimiento',
      };
  }
}

/** Time-ago compacto. "ahora" / "5m" / "3h" / "ayer" / "4d" / fecha. */
function timeAgo(iso: string): string {
  try {
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return '';
    const diffSec = Math.floor((Date.now() - t) / 1000);
    if (diffSec < 60) return 'ahora';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay === 1) return 'ayer';
    if (diffDay < 30) return `${diffDay}d`;
    return new Date(iso).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: 'short',
    });
  } catch {
    return '';
  }
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
        'card-premium rounded-[var(--radius-lg)]',
        'transition-all duration-200 ease-out',
        'active:scale-[0.98]',
        isDone
          ? 'opacity-60'
          : 'hover:border-[color:var(--card-accent)] hover:-translate-y-0.5',
        isReady && 'shadow-[0_0_0_1px_var(--card-accent),0_8px_24px_-4px_rgba(0,0,0,0.55)]',
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
 * QuickAction — Sprint 51.28 rediseño.
 *
 * Cambios vs. 51.16:
 *   - Out: línea de borde-izquierda (le daba look "admin panel" al user).
 *   - In: gradient sutil del accent desde arriba + glow ambient permanent
 *     (no solo en hover) + icono mucho más grande y central + arrow flecha
 *     a la derecha que aparece en hover.
 *   - Identidad del accent ahora viene de: color del icono + color del
 *     gradient bg + color del glow → triple refuerzo, sin línea fea.
 *
 * Estructura:
 *   ┌────────────────────────────┐
 *   │  [bg image desaturada]     │
 *   │  [gradient accent top]     │
 *   │                            │
 *   │   ⊙ icon big               │
 *   │                            │
 *   │   Label                    │
 *   │   Hint texto              →│
 *   └────────────────────────────┘
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
        'card-premium card-premium-hover rounded-[var(--radius-lg)]',
        'p-4 sm:p-5 flex flex-col gap-3',
        'active:scale-[0.97]',
        'min-h-[140px] sm:min-h-[160px]',
      )}
    >
      {/* Imagen de fondo decorativa. Sprint 51.28: subimos opacity un toque
        * (30 → 40 base, 50 → 65 hover) para que el visual del tile no se
        * sienta plano. */}
      <picture aria-hidden>
        <source srcSet={`/hero/${image}.avif`} type="image/avif" />
        <source srcSet={`/hero/${image}.webp`} type="image/webp" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/hero/${image}.webp`}
          alt=""
          className="absolute inset-0 w-full h-full object-cover opacity-40 mix-blend-luminosity transition-opacity duration-300 group-hover:opacity-65"
        />
      </picture>

      {/* Sprint 51.28: gradient con el accent color desde arriba (10%) →
        * transparente. Tinta sutilmente toda la tile con el color de la
        * categoría sin gritarlo. Reemplaza la función del border-left. */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `linear-gradient(180deg, ${accent}18 0%, transparent 35%), linear-gradient(135deg, rgba(18,18,18,0.92) 0%, rgba(18,18,18,0.72) 60%, rgba(18,18,18,0.55) 100%)`,
        }}
      />

      {/* Glow accent ambient — siempre visible bajo, intensifica en hover.
        * Estaba en hover-only antes. Ahora "vive" en el tile. */}
      <div
        aria-hidden
        className="absolute -inset-x-8 -bottom-12 h-32 opacity-30 group-hover:opacity-70 blur-3xl pointer-events-none transition-opacity duration-300"
        style={{
          background: `radial-gradient(ellipse at center, ${accent} 0%, transparent 60%)`,
        }}
      />

      <div className="relative flex flex-col gap-3 h-full">
        {/* Icono más grande + ring + glow propio en hover */}
        <div
          className="size-11 sm:size-12 rounded-full flex items-center justify-center transition-all duration-300 group-hover:scale-110"
          style={{
            background: `linear-gradient(135deg, ${accent}38, ${accent}10)`,
            border: `1px solid ${accent}`,
            boxShadow: `0 0 0 0 ${accent}40`,
          }}
        >
          <Icon
            className="size-5 sm:size-6"
            style={{ color: accent }}
          />
        </div>

        <div className="flex items-end justify-between gap-2 mt-auto">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[14px] sm:text-[15px] text-[var(--color-fg)] font-medium tracking-tight truncate">
              {label}
            </span>
            <span className="text-[11px] text-[var(--color-fg-muted)] truncate">
              {hint}
            </span>
          </div>
          {/* Arrow indicator — invisible base, slide-in al hover */}
          <ArrowRight
            className="size-4 shrink-0 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300"
            style={{ color: accent }}
          />
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

// `isCreditType` quedó obsoleto en Sprint 51.25 — la dirección in/out
// ahora se infiere desde `txMeta(type).direction`. Lo dejé borrado;
// si alguien necesita restaurarlo, está en commit anterior a e1b3f16.
