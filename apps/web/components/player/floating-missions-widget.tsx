/**
 * FloatingMissionsWidget — Sprint 51.24.
 *
 * FAB flotante simétrico al FloatingLeagueWidget, pero del lado IZQUIERDO
 * y con un look más llamativo (gold accent, pulse cuando hay misiones
 * listas, contador de "X listas" en una pill bold).
 *
 * Idea: el player ve el FAB en TODAS las páginas /play/* — si tiene
 * misiones para reclamar, el widget pulsa dorado pidiendo atención. Tap
 * abre modal con cada misión, progreso, premio visible, y CTA inline.
 *
 * Misiones consideradas:
 *   - Ruleta diaria (wheel) → listo si hoy no giró.
 *   - Racha de login (streak) → listo si hoy no reclamó.
 *   - Bonos activos → listo si tiene >= 1.
 *
 * Posicionamiento (espejo del league widget):
 *   - Mobile: fixed bottom-[5.5rem] left-3 (arriba del bottom nav).
 *   - Desktop: fixed bottom-6 left-6.
 *
 * Si NO hay misiones activas en el tenant (ni wheel ni streak ni bonos),
 * no se renderiza el FAB (evita botón vacío).
 */

'use client';

import {
  ArrowRight,
  Check,
  Flame,
  Gift,
  Sparkles,
  Target,
  X,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMyBonuses } from '@/lib/hooks/use-bonuses';
import {
  useActivePromotions,
  useMyStreak,
  useMyWheelRewards,
  todayUtcAnchor,
} from '@/lib/hooks/use-player-promotions';
import { cn } from '@/lib/cn';

type MissionState = 'ready' | 'done' | 'idle';

interface Mission {
  id: string;
  href: string;
  icon: LucideIcon;
  accent: string;
  glow: string;
  title: string;
  subtitle: string;
  rewardLabel: string;
  state: MissionState;
  progress?: number; // 0..1
  ctaReady: string;
  ctaDone: string;
  ctaIdle: string;
}

export function FloatingMissionsWidget() {
  const [open, setOpen] = useState(false);

  // ── Data hooks ─────────────────────────────────────────────────
  const wheelPromos = useActivePromotions('daily_wheel');
  const streakPromos = useActivePromotions('login_streak');
  const wheel = wheelPromos.data?.data[0];
  const streak = streakPromos.data?.data[0];

  const wheelRewards = useMyWheelRewards(wheel?.id ?? null);
  const todayAnchor = todayUtcAnchor();
  const spunToday =
    wheelRewards.data?.data.some(
      (r) =>
        (r.metadata as { dayAnchor?: string } | null)?.dayAnchor ===
        todayAnchor,
    ) ?? false;

  const streakInfo = useMyStreak(streak?.id ?? null);
  const currentDay = streakInfo.data?.progress?.streak ?? 0;
  const claimedToday = streakInfo.data?.progress?.lastClaimDay === todayAnchor;
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

  // ── Build mission list ─────────────────────────────────────────
  const missions: Mission[] = [];

  if (wheel) {
    const maxPrize = parseMaxPrize(
      wheel.config as unknown as Record<string, unknown>,
    );
    missions.push({
      id: 'wheel',
      href: '/play/wheel',
      icon: Sparkles,
      accent: '#FFD700',
      glow: 'rgba(255,215,0,0.45)',
      title: 'Ruleta diaria',
      subtitle: spunToday
        ? 'Ya giraste hoy · volvé mañana'
        : 'Tu giro está esperando',
      rewardLabel: maxPrize
        ? `Hasta ${formatChipsShort(maxPrize)} chips`
        : 'Premio diario',
      state: spunToday ? 'done' : 'ready',
      ctaReady: 'Girar ahora',
      ctaDone: 'Volvé mañana',
      ctaIdle: 'Girar',
    });
  }

  if (streak) {
    const nextDayPrize = parseStreakPrize(
      streak.config as unknown as Record<string, unknown>,
      currentDay,
    );
    missions.push({
      id: 'streak',
      href: '/play/streak',
      icon: Flame,
      accent: '#FF6B35',
      glow: 'rgba(255,107,53,0.45)',
      title: 'Racha de login',
      subtitle: claimedToday
        ? `Día ${currentDay} reclamado · seguí mañana`
        : currentDay > 0
          ? `Día ${currentDay + 1} de ${totalDays} disponible`
          : `Empezá tu racha · día 1 de ${totalDays}`,
      rewardLabel: nextDayPrize
        ? `Hoy: ${formatChipsShort(nextDayPrize)} chips`
        : `${totalDays} días de premios`,
      progress: currentDay / Math.max(1, totalDays),
      state: claimedToday ? 'done' : 'ready',
      ctaReady: 'Reclamar',
      ctaDone: 'Volvé mañana',
      ctaIdle: 'Empezar',
    });
  }

  // Bonos no son una "misión" reclamable en sentido estricto, pero los
  // mostramos como ítem informativo si hay activos — refuerza visibilidad.
  if (activeBonusCount > 0) {
    missions.push({
      id: 'bonuses',
      href: '/play/bonuses',
      icon: Gift,
      accent: '#FFD700',
      glow: 'rgba(255,215,0,0.4)',
      title: 'Bonos activos',
      subtitle:
        activeBonusCount === 1
          ? '1 bonus esperándote'
          : `${activeBonusCount} bonos esperándote`,
      rewardLabel: 'Sumá chips extra',
      state: 'ready',
      ctaReady: 'Ver bonos',
      ctaDone: 'Ver bonos',
      ctaIdle: 'Ver bonos',
    });
  }

  // Si no hay nada, no renderizamos el FAB.
  if (missions.length === 0) return null;

  const readyCount = missions.filter((m) => m.state === 'ready').length;
  const totalCount = missions.length;
  const hasReady = readyCount > 0;

  return (
    <>
      <MissionsFab
        readyCount={readyCount}
        totalCount={totalCount}
        hasReady={hasReady}
        onClick={() => setOpen(true)}
      />
      {open && (
        <MissionsModal
          missions={missions}
          readyCount={readyCount}
          totalCount={totalCount}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// FAB — el botón flotante
// ──────────────────────────────────────────────────────────────────────

function MissionsFab({
  readyCount,
  totalCount,
  hasReady,
  onClick,
}: {
  readyCount: number;
  totalCount: number;
  hasReady: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'fixed z-30 transition-all duration-200',
        // Mobile: arriba del bottom nav (espejo del league widget que va a la derecha)
        'bottom-[5.5rem] left-3',
        // Desktop
        'md:bottom-6 md:left-6',
        'flex items-center gap-2 pl-2.5 pr-3 h-12',
        'rounded-full border-2',
        'backdrop-blur-md',
        'shadow-lg hover:shadow-xl',
        'active:scale-95',
        hasReady
          ? 'bg-[var(--color-bg-elevated)] border-[#FFD700] animate-pulse-gold'
          : 'bg-[var(--color-bg-elevated)] border-[var(--color-border-strong)]',
      )}
      style={
        hasReady
          ? { boxShadow: '0 0 20px rgba(255,215,0,0.45)' }
          : undefined
      }
      aria-label={
        hasReady
          ? `${readyCount} ${readyCount === 1 ? 'misión lista' : 'misiones listas'}`
          : 'Ver misiones del día'
      }
    >
      <div
        className={cn(
          'flex items-center justify-center size-8 rounded-full shrink-0',
          hasReady
            ? 'bg-[#FFD700]/20 text-[#FFD700]'
            : 'bg-[var(--color-bg-subtle)] text-[var(--color-fg-muted)]',
        )}
      >
        <Sparkles className="size-4" />
      </div>
      <div className="flex flex-col items-start leading-none">
        <span className="text-[9px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] font-medium">
          Misiones
        </span>
        <span
          className={cn(
            'text-[13px] font-display tabular-nums tracking-tight',
            hasReady ? 'text-[#FFD700]' : 'text-[var(--color-fg-muted)]',
          )}
        >
          {hasReady ? `${readyCount} listas` : `0 / ${totalCount}`}
        </span>
      </div>
      {hasReady && (
        <span
          aria-hidden
          className="absolute -top-1 -right-1 size-3 rounded-full bg-[#FFD700] border-2 border-[var(--color-bg-elevated)]"
        />
      )}
    </button>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Modal — lista detallada de misiones con progreso y CTAs
// ──────────────────────────────────────────────────────────────────────

function MissionsModal({
  missions,
  readyCount,
  totalCount,
  onClose,
}: {
  missions: Mission[];
  readyCount: number;
  totalCount: number;
  onClose: () => void;
}) {
  // ESC para cerrar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-6 animate-fade-up"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Misiones del día"
    >
      <div
        className={cn(
          'w-full md:max-w-md max-h-[85vh] flex flex-col',
          'surface-glass rounded-t-[var(--radius-xl)] md:rounded-[var(--radius-xl)]',
          'overflow-hidden',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header con glow dorado sutil */}
        <div className="relative px-5 py-4 border-b border-[var(--color-border)] overflow-hidden">
          <div
            aria-hidden
            className="absolute -inset-x-12 -top-8 h-32 opacity-30 blur-3xl pointer-events-none"
            style={{
              background:
                'radial-gradient(ellipse at 70% center, rgba(255,215,0,0.5) 0%, transparent 65%)',
            }}
          />
          <div className="relative flex items-start justify-between gap-3">
            <div className="flex flex-col gap-0.5 min-w-0">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-[#FFD700] font-medium">
                <Target className="size-3" />
                Misiones del día
              </div>
              <h2 className="font-display text-xl tracking-tight text-[var(--color-fg)]">
                {readyCount > 0
                  ? `${readyCount} ${readyCount === 1 ? 'lista' : 'listas'} para reclamar`
                  : 'Volvé mañana por más'}
              </h2>
              <p className="text-[11px] text-[var(--color-fg-subtle)] font-mono">
                {totalCount} {totalCount === 1 ? 'misión' : 'misiones'} hoy
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="size-9 flex items-center justify-center text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg-subtle)] rounded-full transition-colors shrink-0 -mr-1 -mt-1"
              aria-label="Cerrar"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Body: lista scrolleable */}
        <ul className="flex-1 overflow-y-auto p-3 sm:p-4 flex flex-col gap-3">
          {missions.map((m) => (
            <MissionRow key={m.id} mission={m} onNavigate={onClose} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function MissionRow({
  mission,
  onNavigate,
}: {
  mission: Mission;
  onNavigate: () => void;
}) {
  const isReady = mission.state === 'ready';
  const isDone = mission.state === 'done';
  const Icon = mission.icon;
  const ctaLabel = isReady
    ? mission.ctaReady
    : isDone
      ? mission.ctaDone
      : mission.ctaIdle;

  return (
    <li
      className={cn(
        'relative overflow-hidden',
        'card-premium rounded-[var(--radius-lg)] p-4',
        isReady && 'shadow-[var(--shadow-edge),0_0_0_1px_var(--card-glow),var(--shadow-md)]',
        isDone && 'opacity-60',
      )}
      style={
        {
          '--card-glow': mission.accent,
        } as React.CSSProperties
      }
    >
      {/* Glow background — más fuerte en ready */}
      {isReady && (
        <div
          aria-hidden
          className="absolute -inset-x-12 -top-12 h-32 opacity-40 blur-3xl pointer-events-none"
          style={{
            background: `radial-gradient(ellipse at center, ${mission.glow} 0%, transparent 65%)`,
          }}
        />
      )}

      <div className="relative flex items-start gap-3">
        <div
          className={cn(
            'size-11 rounded-full flex items-center justify-center shrink-0 border',
            isReady && 'animate-pulse-gold',
          )}
          style={{
            background: `linear-gradient(135deg, ${mission.accent}30, ${mission.accent}08)`,
            borderColor: mission.accent,
          }}
        >
          {isDone ? (
            <Check className="size-5" style={{ color: mission.accent }} />
          ) : (
            <Icon className="size-5" style={{ color: mission.accent }} />
          )}
        </div>

        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <div className="flex items-center gap-2 justify-between gap-x-3">
            <h3 className="text-[14px] font-medium text-[var(--color-fg)] truncate">
              {mission.title}
            </h3>
            <span
              className="text-[10px] uppercase tracking-[0.1em] font-mono font-medium shrink-0"
              style={{ color: mission.accent }}
            >
              {mission.rewardLabel}
            </span>
          </div>
          <p className="text-[12px] text-[var(--color-fg-muted)] leading-tight">
            {mission.subtitle}
          </p>

          {/* Progress bar opcional */}
          {mission.progress !== undefined && (
            <div className="h-1.5 bg-[var(--color-bg-subtle)] overflow-hidden rounded-full mt-1.5">
              <div
                className="h-full transition-all duration-500 rounded-full"
                style={{
                  width: `${Math.min(100, Math.max(0, mission.progress * 100))}%`,
                  background: `linear-gradient(to right, ${mission.accent}, ${mission.accent}aa)`,
                  boxShadow: `0 0 8px ${mission.accent}60`,
                }}
              />
            </div>
          )}

          {/* CTA */}
          <Link
            href={mission.href}
            onClick={onNavigate}
            className={cn(
              'mt-2 inline-flex items-center justify-center gap-2',
              'h-9 px-4 rounded-[var(--radius)]',
              'text-[12px] font-medium tracking-tight',
              'transition-all duration-150',
              'active:scale-[0.97]',
              isReady
                ? 'text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2),0_4px_12px_-3px]'
                : isDone
                  ? 'bg-[var(--color-bg-subtle)] text-[var(--color-fg-muted)] cursor-default pointer-events-none'
                  : 'bg-[var(--color-bg-subtle)] text-[var(--color-fg)] hover:bg-[var(--color-bg-hover)]',
            )}
            style={
              isReady
                ? {
                    background: `linear-gradient(180deg, ${mission.accent}, ${mission.accent}cc)`,
                    boxShadow: `inset 0 1px 0 0 rgba(255,255,255,0.2), 0 4px 12px -3px ${mission.glow}`,
                  }
                : undefined
            }
          >
            {ctaLabel}
            {!isDone && <ArrowRight className="size-3.5" />}
          </Link>
        </div>
      </div>
    </li>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

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

function parseStreakPrize(
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
