/**
 * /play/streak â€” Login streak del jugador.
 *
 * ComposiciÃ³n:
 *   - Discovery: useActivePromotions('login_streak') â†’ primer match.
 *   - Stat: streak actual + "claimed today / pending today".
 *   - Grid de N cells (uno por prize del config). Cada cell:
 *     - past (streak >= cellDay, NOT today's): claimed histÃ³rico.
 *     - today (la prÃ³xima a reclamar O reciÃ©n reclamada): highlight accent.
 *     - future (streak < cellDay): locked preview.
 *   - CTA "Reclamar dÃ­a N":
 *     - enabled si lastClaimDay !== today.
 *     - disabled "Ya reclamado hoy" si lastClaimDay === today.
 *   - DespuÃ©s del claim: prize toast + grid se refresca.
 *
 * Backend:
 *   - GET /tenant/promotions/active?type=login_streak    (Sprint 27)
 *   - GET /tenant/promotions/:id/my-streak
 *   - POST /tenant/promotions/:id/claim-streak
 */

'use client';

import {
  Bell,
  Calendar,
  Check,
  Coins,
  Flame,
  Gift,
  Lock,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { useMemo } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiError } from '@/lib/api-client';
import {
  todayUtcAnchor,
  useActivePromotions,
  useClaimStreak,
  useMyStreak,
  type PlayerPromotion,
  type StreakConfig,
  type StreakPrize,
  type StreakProgress,
} from '@/lib/hooks/use-player-promotions';
import { cn } from '@/lib/cn';

export default function PlayStreakPage() {
  const promos = useActivePromotions('login_streak');
  const streak = useMemo(() => promos.data?.data?.[0] ?? null, [promos.data]);

  if (promos.isLoading) {
    return (
      <div className="max-w-[900px] mx-auto px-6 py-10 flex flex-col gap-8">
        <Skeleton className="h-12 w-64 bg-[var(--color-bg-subtle)]" />
        <div className="grid grid-cols-3 sm:grid-cols-7 gap-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-28 w-full bg-[var(--color-bg-subtle)]"
            />
          ))}
        </div>
      </div>
    );
  }

  if (promos.isError) {
    return (
      <div className="max-w-[900px] mx-auto px-6 py-10">
        <EmptyState
          hint="streak"
          label="No se pudo cargar el streak."
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => promos.refetch()}
            >
              Reintentar
            </Button>
          }
        />
      </div>
    );
  }

  if (!streak) {
    return (
      <div className="max-w-[900px] mx-auto px-6 py-10 flex flex-col gap-8">
        <PageHeader />
        <EmptyState
          hint="streak"
          label="No hay streak activo en este momento."
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

  /**
   * DÃ­a que la grid debe marcar como "hoy / prÃ³ximo a reclamar":
   *   - Nunca claimed â†’ dÃ­a 1.
   *   - Ya claimed hoy â†’ dÃ­a = currentStreak (el Ãºltimo que reclamÃ³).
   *   - No claimed hoy â†’ dÃ­a = currentStreak + 1 (el que va a reclamar al apretar).
   *
   * Si el streak excede N, normalizamos con onMax. Default: 'hold' (queda en N).
   * Para 'cycle' lo dejarÃ­amos como currentStreak % N pero MVP no necesita.
   */
  const nextDay = useMemo(() => {
    const N = prizes.length || 1;
    const raw = claimedToday ? currentStreak : currentStreak + 1;
    const onMax = config.onMax ?? 'hold';
    if (raw <= N) return raw;
    if (onMax === 'cycle') return ((raw - 1) % N) + 1;
    if (onMax === 'reset') return ((raw - 1) % N) + 1; // similar fenÃ³meno visual
    return N; // hold
  }, [claimedToday, currentStreak, prizes.length, config.onMax]);

  const claim = useClaimStreak(promo.id);

  async function handleClaim() {
    if (claim.isPending || claimedToday || prizes.length === 0) return;
    try {
      const result = await claim.mutateAsync();
      toast.success(
        `DÃ­a ${result.streak} reclamado Â· ${formatPrizeShort(result.prize)}`,
        {
          description:
            result.prize.kind === 'chips'
              ? 'Acreditado en tu wallet.'
              : result.prize.kind === 'bonus'
                ? 'Bono activo en /play/bonuses.'
                : undefined,
        },
      );
    } catch (err) {
      if (isApiError(err) && err.code === 'PROMOTION_ALREADY_CLAIMED') {
        toast.info('Ya reclamaste el premio de hoy. VolvÃ© maÃ±ana.');
      } else if (
        isApiError(err) &&
        err.code === 'FUNDER_INSUFFICIENT_BALANCE'
      ) {
        toast.error(
          'El streak estÃ¡ temporalmente sin fondos. Avisale al cajero.',
        );
      } else if (isApiError(err)) {
        toast.error(err.message || 'No se pudo reclamar.');
      } else {
        toast.error('Error de conexiÃ³n.');
      }
    }
  }

  return (
    <div className="max-w-[900px] mx-auto px-6 py-10 flex flex-col gap-8">
      <PageHeader />

      <StatBar
        promo={promo}
        progress={progress}
        claimedToday={claimedToday}
      />

      {prizes.length === 0 ? (
        <EmptyState
          hint="streak"
          label="El streak no tiene premios configurados todavÃ­a."
        />
      ) : (
        <PrizeGrid
          prizes={prizes}
          nextDay={nextDay}
          claimedToday={claimedToday}
        />
      )}

      <div className="flex flex-col items-center gap-3 pt-2">
        <Button
          variant="primary"
          size="lg"
          onClick={handleClaim}
          disabled={
            claim.isPending || claimedToday || prizes.length === 0
          }
        >
          {claim.isPending ? (
            <>
              <span className="size-4 border-2 border-current border-r-transparent animate-spin rounded-full" />
              Reclamandoâ€¦
            </>
          ) : claimedToday ? (
            <>
              <Check className="size-4" />
              Ya reclamaste hoy
            </>
          ) : (
            <>
              <Sparkles className="size-4" />
              Reclamar dÃ­a {nextDay}
            </>
          )}
        </Button>
        {config.forgivenessDays != null && config.forgivenessDays > 0 && (
          <p className="text-[11px] text-[var(--color-fg-subtle)] text-center">
            Si te salteÃ¡s mÃ¡s de {config.forgivenessDays}{' '}
            {config.forgivenessDays === 1 ? 'dÃ­a' : 'dÃ­as'}, el streak se
            resetea a 1.
          </p>
        )}
      </div>
    </div>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Componentes auxiliares
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function PageHeader() {
  return (
    <header className="flex flex-col gap-2 items-center text-center">
      <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
        <Flame className="size-3" />
        Promociones Â· Login Streak
      </span>
      <h1 className="font-display text-[2.5rem] leading-none tracking-tight">
        Racha diaria
      </h1>
    </header>
  );
}

function StatBar({
  promo,
  progress,
  claimedToday,
}: {
  promo: PlayerPromotion;
  progress: StreakProgress | null;
  claimedToday: boolean;
}) {
  const streak = progress?.streak ?? 0;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <Stat
        label="Racha actual"
        value={String(streak)}
        hint={
          streak === 0
            ? 'EmpezÃ¡ hoy'
            : streak === 1
              ? '1 dÃ­a seguido'
              : `${streak} dÃ­as seguidos`
        }
        icon={Flame}
        accent={streak > 0}
      />
      <Stat
        label="Hoy"
        value={claimedToday ? 'Reclamado' : 'Pendiente'}
        hint={
          claimedToday
            ? 'VolvÃ© maÃ±ana despuÃ©s de las 00:00 UTC.'
            : 'HacÃ© click en el botÃ³n para reclamar.'
        }
        icon={claimedToday ? Check : Calendar}
        accent={!claimedToday}
      />
      <Stat
        label="PromociÃ³n"
        value={promo.name}
        hint={promo.code}
        icon={Sparkles}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: typeof Flame;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1 p-4 bg-[var(--color-bg-elevated)] border',
        accent
          ? 'border-l-2 border-l-[var(--color-accent)] border-[var(--color-border)]'
          : 'border-[var(--color-border)]',
      )}
    >
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-medium">
        <Icon className="size-3" />
        {label}
      </div>
      <div className="text-[20px] font-display text-[var(--color-fg)] truncate">
        {value}
      </div>
      {hint && (
        <div className="text-[11px] text-[var(--color-fg-subtle)] truncate">
          {hint}
        </div>
      )}
    </div>
  );
}

function PrizeGrid({
  prizes,
  nextDay,
  claimedToday,
}: {
  prizes: StreakPrize[];
  nextDay: number;
  claimedToday: boolean;
}) {
  return (
    <ul
      className={cn(
        'grid gap-3',
        'grid-cols-3 sm:grid-cols-4',
        prizes.length >= 7 && 'md:grid-cols-7',
      )}
    >
      {prizes.map((prize, i) => {
        const day = i + 1;
        // Estados:
        //   past:    day < nextDay (ya claimed en dÃ­as previos).
        //   current: day === nextDay (es el de hoy, claimed o claimable).
        //   future:  day > nextDay (locked preview).
        const isPast = day < nextDay;
        const isCurrent = day === nextDay;
        const isClaimedToday = isCurrent && claimedToday;
        const Icon = iconForPrize(prize.kind);
        return (
          <li
            key={day}
            className={cn(
              'flex flex-col items-center gap-2 p-3',
              'border bg-[var(--color-bg-elevated)]',
              'transition-colors',
              isCurrent
                ? isClaimedToday
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent-subtle)]'
                  : 'border-[var(--color-accent)] shadow-[0_0_0_2px_var(--color-accent-glow)]'
                : isPast
                  ? 'border-[var(--color-border)] opacity-70'
                  : 'border-[var(--color-border)] opacity-50',
            )}
          >
            <span
              className={cn(
                'text-[10px] uppercase tracking-[0.1em] font-medium',
                isCurrent
                  ? 'text-[var(--color-accent-text)]'
                  : 'text-[var(--color-fg-subtle)]',
              )}
            >
              DÃ­a {day}
            </span>
            <div
              className={cn(
                'size-10 flex items-center justify-center border',
                isCurrent
                  ? 'border-[var(--color-accent)] text-[var(--color-accent-text)] bg-[var(--color-bg-elevated)]'
                  : isPast
                    ? 'border-[var(--color-border)] text-[var(--color-fg-muted)]'
                    : 'border-[var(--color-border)] text-[var(--color-fg-subtle)]',
              )}
            >
              {isPast ? (
                <Check className="size-4" />
              ) : day > nextDay ? (
                <Lock className="size-3.5" />
              ) : (
                <Icon className="size-4" />
              )}
            </div>
            <span
              className={cn(
                'text-[12px] text-center leading-tight',
                isCurrent
                  ? 'text-[var(--color-fg)] font-medium'
                  : 'text-[var(--color-fg-muted)]',
              )}
            >
              {prize.label ?? formatPrizeShort(prize)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Helpers
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function iconForPrize(kind: StreakPrize['kind']) {
  if (kind === 'chips') return Coins;
  if (kind === 'bonus') return Gift;
  if (kind === 'free_spins') return RefreshCw;
  return Bell;
}

function formatPrizeShort(prize: StreakPrize): string {
  if (prize.kind === 'chips') return `${prize.amount ?? 0} chips`;
  if (prize.kind === 'try_again') return 'ProbÃ¡ de nuevo';
  if (prize.kind === 'bonus') return 'Bono';
  if (prize.kind === 'free_spins') return `${prize.amount ?? 0} free spins`;
  return prize.kind;
}
