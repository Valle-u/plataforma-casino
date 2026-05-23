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
  Flame,
  Gift,
  Sparkles,
  Wallet as WalletIcon,
} from 'lucide-react';
import Link from 'next/link';
import type { ComponentType, SVGProps } from 'react';
import { useAnimatedNumber } from '@/lib/hooks/use-animated-number';
import { useAuth } from '@/lib/auth-context';
import { useMyBonuses } from '@/lib/hooks/use-bonuses';
import {
  useActivePromotions,
  useMyStreak,
  useMyWheelRewards,
  todayUtcAnchor,
} from '@/lib/hooks/use-player-promotions';
import { useMyTransactions, useMyWallet } from '@/lib/hooks/use-wallet';
import { cn } from '@/lib/cn';

export default function PlayDashboardPage() {
  const { user } = useAuth();
  const wallet = useMyWallet();
  const txs = useMyTransactions(5, 0);
  const myBonuses = useMyBonuses({
    statuses: ['active', 'pending'],
    limit: 5,
  });

  const balance = wallet.data?.balance;
  const lockedBalance = wallet.data?.lockedBalance;
  const hasLocked = lockedBalance && Number(lockedBalance) > 0;

  return (
    // px-4 sm:px-6 para mobile-first (16px en mobile vs 24px desktop).
    <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col gap-6 sm:gap-10">
      {/* Greeting + hero balance — bloque visual de impacto */}
      <header className="flex flex-col gap-1.5 animate-fade-up">
        <span className="text-[10px] sm:text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium">
          Bienvenido de vuelta
        </span>
        <h1 className="font-display text-3xl sm:text-[3rem] leading-none tracking-tight">
          Hola, {user?.displayName?.split(' ')[0] ?? user?.username ?? 'jugador'}
        </h1>
      </header>

      {/* Hero balance — animated counter, glow pulse, mobile-friendly padding */}
      <section className="relative animate-fade-up">
        <div
          aria-hidden
          className="absolute -inset-x-4 sm:-inset-x-8 -top-4 sm:-top-8 h-48 sm:h-64 opacity-30 blur-3xl pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse at center, var(--color-accent-glow) 0%, transparent 65%)',
          }}
        />
        <div className="relative border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-5 sm:p-10 flex flex-col gap-4 sm:gap-6">
          <div className="flex items-center gap-2 text-[10px] sm:text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)]">
            <Coins className="size-3 text-[var(--color-accent-text)]" />
            Tu saldo
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
      </section>

      {/* Misiones del día — strip horizontal con scroll mobile */}
      <MissionsStrip />

      {/* Quick actions: grid responsive */}
      <section className="flex flex-col gap-3 animate-fade-up">
        <h2 className="text-[10px] sm:text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-medium">
          Accesos rápidos
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-[var(--color-border)]">
          <QuickAction
            href="/play/deposits"
            icon={ArrowDownToLine}
            label="Depositar"
            hint="Cargar saldo"
          />
          <QuickAction
            href="/play/withdrawals"
            icon={ArrowUpToLine}
            label="Retirar"
            hint="Solicitar cobro"
          />
          <QuickAction
            href="/play/lobby"
            icon={WalletIcon}
            label="Casino"
            hint="Ver juegos"
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
// Misiones strip — dopamine prime
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
  const totalDays = Array.isArray(
    (streak?.config as { prizes?: unknown[] } | undefined)?.prizes,
  )
    ? (streak!.config as { prizes: unknown[] }).prizes.length
    : 7;

  return (
    <section className="flex flex-col gap-3 animate-fade-up">
      <h2 className="text-[10px] sm:text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-medium flex items-center gap-1.5">
        <Sparkles className="size-3 text-[var(--color-accent-text)]" />
        Misiones del día
      </h2>
      {/* Scroll horizontal en mobile (snap), grid en desktop */}
      <div className="flex md:grid md:grid-cols-3 gap-3 overflow-x-auto md:overflow-visible -mx-4 sm:-mx-6 md:mx-0 px-4 sm:px-6 md:px-0 pb-2 md:pb-0 snap-x snap-mandatory md:snap-none">
        {wheel && (
          <MissionCard
            href="/play/wheel"
            icon={Sparkles}
            iconColorClass="text-[#FFD700]"
            iconBgClass="bg-[#FFD700]/10"
            title="Ruleta diaria"
            state={spunToday ? 'done' : 'ready'}
            stateLabel={spunToday ? 'Ya giraste hoy' : '¡Reclamá tu giro!'}
            cta={spunToday ? 'Volvé mañana' : 'Girar'}
          />
        )}
        {streak && (
          <MissionCard
            href="/play/streak"
            icon={Flame}
            iconColorClass="text-[#FF6B35]"
            iconBgClass="bg-[#FF6B35]/10"
            title="Racha de login"
            state={currentStreakDay > 0 ? 'ready' : 'idle'}
            stateLabel={
              currentStreakDay > 0
                ? `Día ${currentStreakDay} de ${totalDays}`
                : 'Empezá hoy'
            }
            progress={currentStreakDay / Math.max(1, totalDays)}
            cta="Reclamar"
          />
        )}
        <MissionCard
          href="/play/bonuses"
          icon={Gift}
          iconColorClass="text-[var(--color-accent-text)]"
          iconBgClass="bg-[var(--color-accent-subtle)]"
          title="Bonos activos"
          state="info"
          stateLabel="Ver mis bonos"
          cta="Abrir"
        />
      </div>
    </section>
  );
}

interface MissionCardProps {
  href: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  iconColorClass: string;
  iconBgClass: string;
  title: string;
  state: 'ready' | 'done' | 'idle' | 'info';
  stateLabel: string;
  cta: string;
  progress?: number; // 0..1
}

function MissionCard({
  href,
  icon: Icon,
  iconColorClass,
  iconBgClass,
  title,
  state,
  stateLabel,
  cta,
  progress,
}: MissionCardProps) {
  const isDone = state === 'done';
  return (
    <Link
      href={href}
      className={cn(
        'group relative shrink-0 w-[260px] md:w-auto snap-start',
        'flex flex-col gap-3 p-4',
        'bg-[var(--color-bg-elevated)] border border-[var(--color-border)]',
        'hover:border-[var(--color-accent)] active:scale-[0.98]',
        'transition-all duration-150',
        isDone && 'opacity-60',
        state === 'ready' &&
          'border-l-2 border-l-[var(--color-accent)] hover:border-[var(--color-accent)]',
      )}
    >
      {/* Header: icon + title */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={cn(
              'flex items-center justify-center size-9 rounded-full shrink-0',
              iconBgClass,
            )}
          >
            <Icon className={cn('size-4', iconColorClass)} />
          </div>
          <span className="text-[13px] font-medium text-[var(--color-fg)] truncate">
            {title}
          </span>
        </div>
        {state === 'ready' && (
          <span className="size-2 rounded-full bg-[var(--color-accent)] animate-pulse shrink-0 mt-2" />
        )}
      </div>
      {/* State label */}
      <p
        className={cn(
          'text-[12px] leading-tight',
          isDone
            ? 'text-[var(--color-fg-subtle)]'
            : 'text-[var(--color-fg-muted)]',
        )}
      >
        {stateLabel}
      </p>
      {/* Progress bar (opcional) */}
      {progress !== undefined && (
        <div className="h-1 bg-[var(--color-bg-subtle)] overflow-hidden">
          <div
            className="h-full bg-[var(--color-accent)] transition-all duration-300"
            style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
          />
        </div>
      )}
      {/* CTA */}
      <div className="flex items-center justify-between pt-1 border-t border-[var(--color-border)] mt-auto">
        <span
          className={cn(
            'text-[11px] uppercase tracking-[0.08em] font-medium',
            isDone
              ? 'text-[var(--color-fg-subtle)]'
              : 'text-[var(--color-accent-text)]',
          )}
        >
          {cta}
        </span>
        <ArrowRight
          className={cn(
            'size-3.5',
            isDone
              ? 'text-[var(--color-fg-subtle)]'
              : 'text-[var(--color-accent-text)] group-hover:translate-x-0.5 transition-transform',
          )}
        />
      </div>
    </Link>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────

function QuickAction({
  href,
  icon: Icon,
  label,
  hint,
}: {
  href: string;
  icon: typeof WalletIcon;
  label: string;
  hint: string;
}) {
  return (
    <Link
      href={href}
      className="group bg-[var(--color-bg-elevated)] p-4 sm:p-5 flex flex-col gap-2 sm:gap-3 hover:bg-[var(--color-bg-subtle)] active:scale-[0.98] transition-all border-l-2 border-l-transparent hover:border-l-[var(--color-accent)] min-h-[100px]"
    >
      <Icon className="size-5 text-[var(--color-fg-subtle)] group-hover:text-[var(--color-accent-text)] transition-colors" />
      <div className="flex flex-col gap-0.5">
        <span className="text-[14px] text-[var(--color-fg)] font-medium tracking-tight">
          {label}
        </span>
        <span className="text-[11px] text-[var(--color-fg-subtle)]">{hint}</span>
      </div>
    </Link>
  );
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
