/**
 * /play/streak — Racha diaria.
 *
 * Pantalla "Racha" del handoff. El chrome lo provee play/layout.tsx.
 *
 * Composición:
 *   - Hero "fuego": círculo con la racha actual + título + 3 stats.
 *   - "Esta semana": grilla de N cards (día completado ✓ / hoy ★ / futuro 🔒)
 *     con el premio de cada día.
 *   - Barra de reclamo: "Reclamar día N".
 *
 * Función PRESERVADA (toda la lógica de claim intacta):
 *   - useActivePromotions('login_streak') → promo + config.prizes.
 *   - useMyStreak → progress (streak, lastClaimDay).
 *   - useClaimStreak → POST /claim-streak + confetti/sonido/toast.
 *   - nextDay calc + manejo de errores (ALREADY_CLAIMED / sin fondos).
 */

'use client';

import {
  Bell,
  Check,
  Coins,
  Flame,
  Gift,
  Lock,
  RefreshCw,
  Sparkles,
  Star,
} from 'lucide-react';
import { useMemo } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiError } from '@/lib/api-client';
import { confettiBurst, confettiJackpot } from '@/lib/confetti';
import { soundClaim, soundJackpot } from '@/lib/sounds';
import {
  todayUtcAnchor,
  useActivePromotions,
  useClaimStreak,
  useMyStreak,
  type PlayerPromotion,
  type StreakConfig,
  type StreakPrize,
} from '@/lib/hooks/use-player-promotions';
import { cn } from '@/lib/cn';

const WEEKDAYS_ES = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
const FIRE = '#ff7a18';

export default function PlayStreakPage() {
  const promos = useActivePromotions('login_streak');
  const streak = useMemo(() => promos.data?.data?.[0] ?? null, [promos.data]);

  if (promos.isLoading) {
    return (
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <PageHeader />
        <Skeleton className="h-32 w-full rounded-[var(--radius-lg)] bg-[var(--color-bg-subtle)]" />
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-7">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-28 w-full rounded-[var(--radius-lg)] bg-[var(--color-bg-subtle)]"
            />
          ))}
        </div>
      </div>
    );
  }

  if (promos.isError) {
    return (
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <PageHeader />
        <EmptyState
          label="Ups, no pudimos cargar la racha."
          description="Esperá unos segundos y probá de nuevo."
          action={
            <Button variant="secondary" size="sm" onClick={() => promos.refetch()}>
              Reintentar
            </Button>
          }
        />
      </div>
    );
  }

  if (!streak) {
    return (
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <PageHeader />
        <EmptyState
          label="Todavía no hay una racha activa."
          description="Está atento: cuando la racha arranque, vas a poder reclamar premios cada día."
        />
      </div>
    );
  }

  return <StreakExperience promo={streak} />;
}

function StreakExperience({ promo }: { promo: PlayerPromotion }) {
  const config = promo.config as Partial<StreakConfig>;
  const prizes = useMemo(() => config?.prizes ?? [], [config]);

  const progressQuery = useMyStreak(promo.id);
  const progress = progressQuery.data?.progress ?? null;
  const todayAnchor = todayUtcAnchor();
  const claimedToday = progress?.lastClaimDay === todayAnchor;
  const currentStreak = progress?.streak ?? 0;

  const nextDay = useMemo(() => {
    const N = prizes.length || 1;
    const raw = claimedToday ? currentStreak : currentStreak + 1;
    const onMax = config.onMax ?? 'hold';
    if (raw <= N) return raw;
    if (onMax === 'cycle' || onMax === 'reset') return ((raw - 1) % N) + 1;
    return N;
  }, [claimedToday, currentStreak, prizes.length, config.onMax]);

  const claim = useClaimStreak(promo.id);

  async function handleClaim() {
    if (claim.isPending || claimedToday || prizes.length === 0) return;
    try {
      const result = await claim.mutateAsync();
      const isFinalDay = result.streak >= prizes.length;
      if (isFinalDay) {
        confettiJackpot();
        soundJackpot();
      } else {
        confettiBurst();
        soundClaim();
      }
      toast.success(
        `Día ${result.streak} reclamado · ${formatPrizeShort(result.prize)}`,
        {
          description:
            result.prize.kind === 'chips'
              ? 'Acreditado en tu wallet.'
              : result.prize.kind === 'bonus'
                ? 'Bono activo en Bonos.'
                : undefined,
        },
      );
    } catch (err) {
      if (isApiError(err) && err.code === 'PROMOTION_ALREADY_CLAIMED') {
        toast.info('Ya reclamaste el premio de hoy. Volvé mañana.');
      } else if (isApiError(err) && err.code === 'FUNDER_INSUFFICIENT_BALANCE') {
        toast.error('La racha está temporalmente sin fondos. Avisale al cajero.');
      } else if (isApiError(err)) {
        toast.error(err.message || 'No se pudo reclamar.');
      } else {
        toast.error('Error de conexión.');
      }
    }
  }

  const todayDow = new Date().getDay();
  const weekClaimed = Math.min(currentStreak, prizes.length || 7);
  const nextPrize = prizes[nextDay - 1];

  return (
    <div className="flex flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader />

      {/* Hero "fuego" */}
      <section
        className="flex flex-col items-center gap-5 rounded-[var(--radius-xl)] border border-[color:color-mix(in_srgb,#ff7a18_30%,transparent)] p-6 sm:flex-row sm:gap-7"
        style={{
          backgroundImage:
            'radial-gradient(120% 120% at 0% 0%, color-mix(in srgb, #ff7a18 22%, transparent) 0%, transparent 55%), linear-gradient(120deg, #1a0f06, var(--color-bg-elevated))',
        }}
      >
        {/* Círculo de racha */}
        <div
          className="grid size-24 shrink-0 place-items-center rounded-full"
          style={{
            background: 'radial-gradient(circle at 50% 35%, #ff9a3d, #d9530a)',
            boxShadow: '0 0 32px -6px rgba(255,122,24,.7)',
          }}
        >
          <div className="flex flex-col items-center leading-none text-white">
            <span className="font-display text-[30px]">{currentStreak}</span>
            <span className="text-[9px] uppercase tracking-[0.2em] opacity-90">
              días
            </span>
          </div>
        </div>

        {/* Texto + stats */}
        <div className="flex flex-1 flex-col items-center gap-2 text-center sm:items-start sm:text-left">
          <h2 className="font-display text-[24px] leading-tight">
            {claimedToday ? '¡Vas en racha!' : '¡No cortes la racha!'}
          </h2>
          <p className="text-[13px] text-[var(--color-fg-muted)]">
            {claimedToday
              ? 'Ya sumaste hoy. Volvé mañana para no cortarla.'
              : 'Reclamá el día de hoy para sumar.'}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-8 gap-y-2">
            <HeroStat
              label="Esta semana"
              value={`${weekClaimed} / ${prizes.length || 7}`}
              color="var(--color-success)"
            />
            <HeroStat
              label="Hoy"
              value={claimedToday ? 'Reclamado' : 'Pendiente'}
              color={claimedToday ? 'var(--color-success)' : FIRE}
            />
            <HeroStat
              label="Próximo premio"
              value={nextPrize ? formatPrizeShort(nextPrize) : '—'}
              color="var(--color-accent-text)"
            />
          </div>
        </div>
      </section>

      {/* Esta semana */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-[24px]">Esta semana</h2>
          <span className="text-[12px] text-[var(--color-fg-subtle)]">
            Reclamá cada día para no cortar la racha
          </span>
        </div>

        {prizes.length === 0 ? (
          <EmptyState
            label="Pronto vas a poder reclamar premios acá."
            description="Avisale a tu operador si pensás que esto es un error."
          />
        ) : (
          <ul
            className={cn(
              'grid grid-cols-3 gap-3 sm:grid-cols-4',
              prizes.length >= 7 && 'md:grid-cols-7',
            )}
          >
            {prizes.map((prize, i) => {
              const day = i + 1;
              const isPast = day < nextDay;
              const isCurrent = day === nextDay;
              const isClaimedToday = isCurrent && claimedToday;
              const dow = ((todayDow + (day - nextDay)) % 7 + 7) % 7;
              return (
                <DayCard
                  key={day}
                  weekday={WEEKDAYS_ES[dow]!}
                  prize={prize}
                  isPast={isPast || isClaimedToday}
                  isCurrent={isCurrent && !claimedToday}
                  isFuture={day > nextDay}
                />
              );
            })}
          </ul>
        )}
      </section>

      {/* Barra de reclamo */}
      <section
        className={cn(
          'flex flex-col items-center justify-between gap-3 rounded-[var(--radius-lg)] border p-5 sm:flex-row',
          claimedToday
            ? 'border-[var(--color-border)] bg-[var(--color-bg-elevated)]'
            : 'border-[color:color-mix(in_srgb,var(--color-gold)_35%,transparent)]',
        )}
        style={
          claimedToday
            ? undefined
            : {
                backgroundImage:
                  'radial-gradient(120% 120% at 0% 0%, color-mix(in srgb, var(--color-gold) 14%, transparent) 0%, transparent 60%), var(--color-bg-elevated)',
              }
        }
      >
        <div className="flex flex-col gap-0.5 text-center sm:text-left">
          <span className="text-[14px] font-medium text-[var(--color-fg)]">
            {claimedToday ? 'Ya reclamaste hoy' : 'Premio de hoy listo'}
          </span>
          <span className="text-[12px] text-[var(--color-fg-muted)]">
            {claimedToday
              ? 'Volvé mañana después de las 00:00 UTC.'
              : nextPrize
                ? `Reclamá ${formatPrizeShort(nextPrize)} por el día de hoy.`
                : 'Reclamá el día de hoy.'}
          </span>
        </div>
        <button
          type="button"
          onClick={handleClaim}
          disabled={claim.isPending || claimedToday || prizes.length === 0}
          className="inline-flex h-11 shrink-0 items-center gap-2 rounded-[var(--radius)] px-6 text-[14px] font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          style={
            claimedToday
              ? {
                  background: 'var(--color-bg-subtle)',
                  color: 'var(--color-fg-muted)',
                }
              : { background: 'var(--gradient-gold)', color: '#1a1206' }
          }
        >
          {claim.isPending ? (
            <>
              <span className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
              Reclamando…
            </>
          ) : claimedToday ? (
            <>
              <Check className="size-4" />
              Reclamado
            </>
          ) : (
            <>
              <Sparkles className="size-4" />
              Reclamar día {nextDay}
            </>
          )}
        </button>
      </section>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Componentes
// ──────────────────────────────────────────────────────────────────────

function PageHeader() {
  return (
    <header className="flex flex-col gap-1">
      <span className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent-text)]">
        <Flame className="size-3" />
        Recompensas · Racha
      </span>
      <h1 className="font-display text-[34px] leading-none">Racha diaria</h1>
    </header>
  );
}

function HeroStat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] font-medium uppercase tracking-[0.16em] text-[var(--color-fg-subtle)]">
        {label}
      </span>
      <span className="text-[15px] font-semibold" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

function DayCard({
  weekday,
  prize,
  isPast,
  isCurrent,
  isFuture,
}: {
  weekday: string;
  prize: StreakPrize;
  isPast: boolean;
  isCurrent: boolean;
  isFuture: boolean;
}) {
  const Icon = iconForPrize(prize.kind);
  return (
    <li
      className={cn(
        'flex flex-col items-center gap-2.5 rounded-[var(--radius-lg)] border p-3 transition-all',
        isCurrent
          ? 'border-[var(--color-gold)] shadow-[0_0_24px_-6px_color-mix(in_srgb,var(--color-gold)_70%,transparent)]'
          : isPast
            ? 'border-[var(--color-border)] bg-[var(--color-bg-elevated)]'
            : 'border-[var(--color-border)] bg-[var(--color-bg-elevated)] opacity-60',
      )}
      style={
        isCurrent
          ? {
              backgroundImage:
                'radial-gradient(120% 100% at 50% 0%, color-mix(in srgb, var(--color-gold) 16%, transparent) 0%, transparent 60%), var(--color-bg-elevated)',
            }
          : undefined
      }
    >
      <span
        className={cn(
          'text-[10px] font-medium uppercase tracking-[0.12em]',
          isCurrent ? 'text-[var(--color-gold)]' : 'text-[var(--color-fg-subtle)]',
        )}
      >
        {weekday}
      </span>

      <span
        className="grid size-10 place-items-center rounded-full"
        style={
          isPast
            ? {
                background: 'color-mix(in srgb, var(--color-accent) 22%, transparent)',
                color: 'var(--color-accent-text)',
                boxShadow: '0 0 12px -4px var(--color-accent-glow)',
              }
            : isCurrent
              ? {
                  background: 'color-mix(in srgb, var(--color-gold) 22%, transparent)',
                  color: 'var(--color-gold)',
                  boxShadow: '0 0 14px -3px var(--color-gold)',
                }
              : {
                  background: 'var(--color-bg-subtle)',
                  color: 'var(--color-fg-subtle)',
                }
        }
      >
        {isPast ? (
          <Check className="size-4" />
        ) : isCurrent ? (
          <Star className="size-4" />
        ) : isFuture ? (
          <Lock className="size-3.5" />
        ) : (
          <Icon className="size-4" />
        )}
      </span>

      <span
        className={cn(
          'text-center text-[12px] leading-tight',
          isCurrent
            ? 'font-medium text-[var(--color-fg)]'
            : 'text-[var(--color-fg-muted)]',
        )}
      >
        {rewardChip(prize)}
      </span>
    </li>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function iconForPrize(kind: StreakPrize['kind']) {
  if (kind === 'chips') return Coins;
  if (kind === 'bonus') return Gift;
  if (kind === 'free_spins') return RefreshCw;
  return Bell;
}

function rewardChip(prize: StreakPrize): string {
  if (prize.label) return prize.label;
  if (prize.kind === 'chips') return `+${prize.amount ?? 0}`;
  if (prize.kind === 'free_spins') return `+${prize.amount ?? 0} giros`;
  if (prize.kind === 'bonus') return 'Bono';
  if (prize.kind === 'try_again') return 'Otra';
  return prize.kind;
}

function formatPrizeShort(prize: StreakPrize): string {
  if (prize.kind === 'chips') return `${prize.amount ?? 0} fichas`;
  if (prize.kind === 'try_again') return 'Probá de nuevo';
  if (prize.kind === 'bonus') return prize.label ?? 'Bono';
  if (prize.kind === 'free_spins') return `${prize.amount ?? 0} giros gratis`;
  return prize.kind;
}
