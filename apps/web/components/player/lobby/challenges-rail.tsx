'use client';

/**
 * ChallengesRail — columna derecha del lobby: el "Centro de Retos".
 *
 * Rediseño "Neón Milonga". Columna fija de 326px, sticky a top-0, alto
 * full viewport con scroll interno. Densa: mucha info en poco ancho, así
 * que todo es compacto (11/12px) y los headings son mini-uppercase.
 *
 * Tiene estado/timer (countdown en vivo de La Liga), por eso 'use client'.
 *
 * Datos 100% DEMO definidos como constantes acá abajo. No hace fetch.
 */

import { useEffect, useState } from 'react';
import { Gift, Coins, Zap } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useMyBonuses, type BonusRow } from '@/lib/hooks/use-bonuses';
import {
  useLeagues,
  useLeagueStandings,
  type LeagueRow,
  type StandingRow,
  type StandingsView,
} from '@/lib/hooks/use-leagues';
import {
  todayUtcAnchor,
  useActivePromotions,
  useMyStreak,
  useMyWheelRewards,
} from '@/lib/hooks/use-player-promotions';

/* ------------------------------------------------------------------ */
/* Datos demo                                                          */
/* ------------------------------------------------------------------ */

/** Color por puesto: 1 oro, 2 plata, 3 bronce, resto muted. */
const RANK_COLOR: Record<number, string> = {
  1: 'var(--color-gold)',
  2: '#c0c0c0',
  3: '#cd7f32',
};
function rankColor(rank: number): string {
  return RANK_COLOR[rank] ?? 'var(--color-fg-muted)';
}

interface Mission {
  title: string;
  reward: string;
  rewardColor: string;
  cur: number;
  total: number;
  /** color del fill de la barra (también del glow) */
  color: string;
  glow: string;
  done?: boolean;
}

const MISSIONS: Mission[] = [
  {
    title: 'Jugá 10 rondas',
    reward: '+50 giros',
    rewardColor: 'var(--color-accent-text)',
    cur: 7,
    total: 10,
    color: 'var(--color-accent)',
    glow: 'rgba(255,46,160,.5)',
  },
  {
    title: 'Apostá hoy',
    reward: '+$1.000',
    rewardColor: 'var(--color-success)',
    cur: 3_200,
    total: 5_000,
    color: 'var(--color-success)',
    glow: 'rgba(57,211,83,.5)',
  },
  {
    title: 'Ganá 3 seguidas',
    reward: '+2 puntos',
    rewardColor: 'var(--color-gold)',
    cur: 1,
    total: 3,
    color: 'var(--color-gold)',
    glow: 'rgba(240,196,106,.55)',
  },
  {
    title: 'Probá un juego nuevo',
    reward: '+20 puntos',
    rewardColor: 'var(--color-gold)',
    cur: 1,
    total: 1,
    color: 'var(--color-success)',
    glow: 'rgba(57,211,83,.5)',
    done: true,
  },
];

/** Iconito por tipo de bono. */
function bonusIcon(type: string | null | undefined): typeof Gift {
  if (type === 'free_spins') return Coins;
  if (type === 'cashback' || type === 'reload') return Zap;
  return Gift;
}

const WEEKDAYS_RAIL = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

/** Extrae el premio mayor (posición 1) de la config de prizes. */
function topPrize(prizes: Record<string, unknown> | undefined): number | null {
  const p1 = prizes?.['1'] as { amount?: number } | undefined;
  if (p1 && typeof p1.amount === 'number') return p1.amount;
  for (const v of Object.values(prizes ?? {})) {
    const amt = (v as { amount?: number } | null)?.amount;
    if (typeof amt === 'number') return amt;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function initials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/** "Xd HH:MM:SS" a partir de milisegundos restantes. */
function formatCountdown(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86_400);
  const hours = Math.floor((totalSec % 86_400) / 3_600);
  const mins = Math.floor((totalSec % 3_600) / 60);
  const secs = totalSec % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${days}d ${pad(hours)}:${pad(mins)}:${pad(secs)}`;
}

/* ------------------------------------------------------------------ */
/* Componente                                                          */
/* ------------------------------------------------------------------ */

export function ChallengesRail({ inline = false }: { inline?: boolean } = {}) {
  // Datos REALES de La Liga: liga activa + standings (top 4 + mi posición).
  const { user } = useAuth();
  const leaguesQ = useLeagues({ status: 'active', limit: 1 });
  const activeLeague = leaguesQ.data?.data?.[0] ?? null;
  const standingsQ = useLeagueStandings(activeLeague?.id ?? null, 4);

  const endsAtMs = activeLeague ? new Date(activeLeague.endsAt).getTime() : 0;
  const [remaining, setRemaining] = useState(() => endsAtMs - Date.now());

  useEffect(() => {
    if (!endsAtMs) return;
    setRemaining(endsAtMs - Date.now());
    const id = setInterval(() => {
      setRemaining(endsAtMs - Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, [endsAtMs]);

  // inline (mobile): fluye normal, sin sticky/alto fijo/ancho fijo/scroll propio.
  // default (desktop): columna sticky de 326px, full viewport con scroll interno.
  const rootCls = inline
    ? 'flex w-full flex-col gap-5'
    : 'sticky top-0 flex h-screen w-[326px] shrink-0 flex-col gap-5 overflow-y-auto p-4';

  // En inline aprovechamos el ancho: 2 columnas en sm+. En desktop, 1 columna (rail angosto).
  const cardsCls = inline ? 'grid grid-cols-1 gap-5 sm:grid-cols-2' : 'contents';

  return (
    <aside className={rootCls}>
      {/* Header del rail */}
      <header className="flex items-end justify-between">
        <h2 className="font-display text-[20px] leading-none text-[var(--color-fg)]">RETOS</h2>
        <span className="text-[11px] uppercase tracking-[.18em] text-[var(--color-fg-subtle)]">
          Tu progreso
        </span>
      </header>

      <div className={cardsCls}>
        {/* 1 — LA LIGA (datos reales) ----------------------------------- */}
        <LeagueCard
          league={activeLeague}
          standings={standingsQ.data}
          myUserId={user?.id ?? null}
          countdown={formatCountdown(remaining)}
        />

        {/* 2 — MISIONES -------------------------------------------------- */}
        <MissionsCard />

        {/* 3 — BONOS ACTIVOS -------------------------------------------- */}
        <BonusesCard />

        {/* 4 — RULETA DIARIA -------------------------------------------- */}
        <DailyWheelCard />

        {/* 5 — RACHA DIARIA --------------------------------------------- */}
        <StreakCard />
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* 1 — La Liga                                                         */
/* ------------------------------------------------------------------ */

function standingName(s: StandingRow): string {
  return s.displayName || s.username || 'Jugador';
}

function LeagueCard({
  league,
  standings,
  myUserId,
  countdown,
}: {
  league: LeagueRow | null;
  standings: StandingsView | undefined;
  myUserId: string | null;
  countdown: string;
}) {
  // Sin liga activa: card mínima.
  if (!league) {
    return (
      <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-4">
        <h3 className="font-display text-[16px] leading-tight text-[var(--color-fg)]">La Liga</h3>
        <p className="mt-2 text-[12px] text-[var(--color-fg-subtle)]">
          No hay una liga activa en este momento. Volvé pronto.
        </p>
      </section>
    );
  }

  const pozo = topPrize(league.prizes);
  const top = standings?.top ?? [];
  const everyone = [...(standings?.top ?? []), ...(standings?.around ?? [])];
  const me = myUserId
    ? (everyone.find((s) => s.userId === myUserId) ?? null)
    : null;
  // Que "tu posición" no se duplique si ya estás en el top visible.
  const meInTop = me ? top.some((s) => s.userId === me.userId) : false;

  return (
    <section
      className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-4"
      style={{ boxShadow: 'inset 0 0 0 1px rgba(255,46,160,.06)' }}
    >
      {/* chips superiores */}
      <div className="mb-2.5 flex items-center justify-between">
        <span className="inline-flex items-center rounded-full border border-[var(--color-accent-border)] bg-[rgba(255,46,160,.12)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[.14em] text-[var(--color-accent-text)]">
          Liga {league.period === 'weekly' ? 'semanal' : league.period}
        </span>
        <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[.14em] text-[var(--color-fg-muted)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)] animate-tg-live" />
          En vivo
        </span>
      </div>

      <h3 className="font-display text-[16px] leading-tight text-[var(--color-fg)]">{league.name}</h3>

      {/* Pozo + countdown */}
      <div className="mt-2 flex items-end justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[.16em] text-[var(--color-fg-subtle)]">Pozo</p>
          <p
            className="font-display text-[22px] leading-none tabular-nums text-[var(--color-gold)]"
            style={{ textShadow: '0 0 14px rgba(240,196,106,.35)' }}
          >
            {pozo != null ? `$ ${pozo.toLocaleString('es-AR')}` : '—'}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-[.16em] text-[var(--color-fg-subtle)]">Cierra en</p>
          <p className="text-[13px] font-medium tabular-nums text-[var(--color-accent-text)]">{countdown}</p>
        </div>
      </div>

      {/* Top 4 */}
      <div className="mt-3 flex flex-col gap-1.5">
        {top.length === 0 ? (
          <p className="text-[11px] text-[var(--color-fg-subtle)]">
            Todavía sin participantes. ¡Jugá y sé el primero!
          </p>
        ) : (
          top.map((p) => {
            const color = rankColor(p.position);
            return (
              <div key={p.userId} className="flex items-center gap-2.5">
                <span
                  className="w-4 shrink-0 text-center text-[12px] font-medium tabular-nums"
                  style={{ color }}
                >
                  {p.position}
                </span>
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-medium"
                  style={{ background: `color-mix(in srgb, ${color} 18%, transparent)`, color }}
                >
                  {initials(standingName(p))}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--color-fg)]">
                  {standingName(p)}
                </span>
                <span className="shrink-0 text-[12px] tabular-nums text-[var(--color-fg-muted)]">
                  {Math.round(Number(p.score)).toLocaleString('es-AR')}
                </span>
              </div>
            );
          })
        )}

        {/* Tu posición (solo si estás rankeado y no en el top visible) */}
        {me && !meInTop && (
          <div className="mt-1 flex items-center gap-2.5 rounded-[var(--radius-sm)] border border-[var(--color-accent-border)] bg-[rgba(255,46,160,.1)] px-2 py-1.5">
            <span className="w-4 shrink-0 text-center text-[12px] font-medium tabular-nums text-[var(--color-accent-text)]">
              {me.position}
            </span>
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-medium text-[var(--color-accent-text)]"
              style={{ background: 'rgba(255,46,160,.15)' }}
            >
              {initials(standingName(me))}
            </span>
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium uppercase tracking-[.1em] text-[var(--color-accent-text)]">
              Tu posición
            </span>
            <span className="shrink-0 text-[12px] tabular-nums text-[var(--color-fg)]">
              {Math.round(Number(me.score)).toLocaleString('es-AR')}
            </span>
          </div>
        )}
      </div>

      <a
        href="/play/lobby"
        className="mt-3 block w-full rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] bg-transparent py-2 text-center text-[12px] font-medium text-[var(--color-fg-muted)] transition-colors duration-200 hover:border-[var(--color-accent-border)] hover:text-[var(--color-accent-text)]"
      >
        Ver liga completa
      </a>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 2 — Misiones                                                        */
/* ------------------------------------------------------------------ */

function MissionsCard() {
  const completed = MISSIONS.filter((m) => m.done).length;
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[11px] font-medium uppercase tracking-[.16em] text-[var(--color-fg-subtle)]">
          Misiones
        </h3>
        <span className="text-[11px] tabular-nums text-[var(--color-fg-muted)]">
          {completed} / {MISSIONS.length} listas
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {MISSIONS.map((m) => {
          const pct = Math.min(100, Math.round((m.cur / m.total) * 100));
          return (
            <div key={m.title}>
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-[12px] text-[var(--color-fg)]">{m.title}</span>
                <span
                  className="shrink-0 text-[11px] font-medium tabular-nums"
                  style={{ color: m.rewardColor }}
                >
                  {m.reward}
                </span>
              </div>

              {m.done ? (
                <button
                  type="button"
                  className="mt-1.5 text-[12px] font-medium text-[var(--color-success)] transition-opacity hover:opacity-80"
                >
                  Reclamar →
                </button>
              ) : (
                <>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-bg-subtle)]">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${pct}%`,
                        background: m.color,
                        boxShadow: `0 0 8px ${m.glow}`,
                      }}
                    />
                  </div>
                  <span className="mt-1 block text-[10px] tabular-nums text-[var(--color-fg-subtle)]">
                    {m.cur.toLocaleString('es-AR')} / {m.total.toLocaleString('es-AR')}
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 3 — Bonos activos                                                   */
/* ------------------------------------------------------------------ */

function bonusExpiryChip(b: BonusRow): string {
  if (!b.expiresAt) return 'Activo';
  const days = Math.ceil(
    (new Date(b.expiresAt).getTime() - Date.now()) / 86_400_000,
  );
  if (days <= 0) return 'Hoy';
  return `Vence ${days}d`;
}

function BonusesCard() {
  // Datos REALES: bonos activos del usuario.
  const { data } = useMyBonuses({ limit: 10 });
  const active = (data?.data ?? [])
    .filter((b) => b.status === 'active' || b.status === 'pending')
    .slice(0, 3);

  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-4">
      <h3 className="mb-3 text-[11px] font-medium uppercase tracking-[.16em] text-[var(--color-fg-subtle)]">
        Bonos activos
      </h3>

      {active.length === 0 ? (
        <p className="text-[11px] text-[var(--color-fg-subtle)]">
          No tenés bonos activos.{' '}
          <a href="/play/bonuses" className="text-[var(--color-accent-text)]">
            Ver bonos →
          </a>
        </p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {active.map((b) => {
            const Icon = bonusIcon(b.definitionType);
            const title = b.definitionName ?? 'Bono';
            const sub = `${Number(b.remainingAmount).toLocaleString('es-AR')} fichas`;
            return (
              <a
                key={b.id}
                href="/play/bonuses"
                className="flex items-center gap-3"
              >
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-accent-border)] bg-[rgba(255,46,160,.1)]"
                  style={{ boxShadow: '0 0 12px rgba(255,46,160,.25)' }}
                >
                  <Icon className="h-4 w-4 text-[var(--color-accent-text)]" strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-medium text-[var(--color-fg)]">{title}</p>
                  <p className="truncate text-[11px] text-[var(--color-fg-muted)]">{sub}</p>
                </div>
                <span className="shrink-0 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-fg-muted)]">
                  {bonusExpiryChip(b)}
                </span>
              </a>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 4 — Ruleta diaria                                                  */
/* ------------------------------------------------------------------ */

function DailyWheelCard() {
  // Datos REALES: ¿hay ruleta activa? ¿ya giró hoy?
  const wheels = useActivePromotions('daily_wheel');
  const wheel = wheels.data?.data?.[0] ?? null;
  const rewards = useMyWheelRewards(wheel?.id ?? null, { limit: 5 });
  const today = todayUtcAnchor();
  const spunToday = (rewards.data?.data ?? []).some((r) => {
    const a = typeof r.metadata?.dayAnchor === 'string' ? r.metadata.dayAnchor : null;
    return a === today;
  });

  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-4">
      <div className="flex items-center gap-3.5">
        {/* Rueda */}
        <div className="relative h-[72px] w-[72px] shrink-0">
          <div
            className="h-full w-full rounded-full animate-tg-spin"
            style={{
              background:
                'conic-gradient(var(--color-accent) 0deg 60deg, var(--color-cyan) 60deg 120deg, var(--color-gold) 120deg 180deg, var(--color-magenta) 180deg 240deg, var(--color-purple) 240deg 300deg, var(--color-success) 300deg 360deg)',
              boxShadow: '0 0 18px rgba(123,47,247,.35)',
            }}
          />
          <span className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-bg)]" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[12px] leading-snug text-[var(--color-fg)]">
            {spunToday
              ? 'Ya giraste hoy — volvé mañana'
              : 'Ruleta diaria — girá gratis cada día'}
          </p>
          <a
            href="/play/wheel"
            className="mt-2 inline-flex w-full items-center justify-center rounded-[var(--radius-sm)] py-2 text-[12px] font-medium text-white transition-transform duration-200 hover:-translate-y-0.5"
            style={{
              background: spunToday
                ? 'var(--color-bg-subtle)'
                : 'linear-gradient(135deg, var(--color-purple), var(--color-magenta))',
              boxShadow: spunToday ? 'none' : '0 0 16px rgba(255,62,201,.35)',
              color: spunToday ? 'var(--color-fg-muted)' : '#fff',
            }}
          >
            {spunToday ? 'Ver ruleta' : 'Girar gratis'}
          </a>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 5 — Racha diaria                                                   */
/* ------------------------------------------------------------------ */

function StreakCard() {
  // Datos REALES: promo de racha activa + progreso del usuario.
  const streaks = useActivePromotions('login_streak');
  const promo = streaks.data?.data?.[0] ?? null;
  const sQ = useMyStreak(promo?.id ?? null);
  const progress = sQ.data?.progress;
  const currentStreak = progress?.streak ?? 0;
  const claimedToday = progress?.lastClaimDay === todayUtcAnchor();
  const prizesLen =
    (promo?.config as { prizes?: unknown[] } | undefined)?.prizes?.length ?? 7;
  const total = Math.min(Math.max(prizesLen, 1), 7);
  const nextDay = claimedToday ? currentStreak : currentStreak + 1;
  const todayDow = new Date().getDay();

  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-4">
      <h3 className="mb-3 text-[11px] font-medium uppercase tracking-[.16em] text-[var(--color-fg-subtle)]">
        Racha diaria
      </h3>

      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: total }, (_, i) => {
          const day = i + 1;
          const dow = ((todayDow + (day - nextDay)) % 7 + 7) % 7;
          const label = WEEKDAYS_RAIL[dow];
          const isDone = day < nextDay || (day === nextDay && claimedToday);
          const isToday = day === nextDay && !claimedToday;
          if (isDone) {
            return (
              <div
                key={day}
                className="flex aspect-square flex-col items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-accent-border)] bg-[rgba(255,46,160,.12)] text-[var(--color-accent-text)]"
              >
                <span className="text-[10px] leading-none">{label}</span>
                <span className="mt-0.5 text-[11px] leading-none">✓</span>
              </div>
            );
          }
          if (isToday) {
            return (
              <div
                key={day}
                className="flex aspect-square flex-col items-center justify-center rounded-[var(--radius-sm)] border text-[var(--color-gold)]"
                style={{
                  borderColor: 'var(--color-gold)',
                  background: 'rgba(240,196,106,.14)',
                  boxShadow: '0 0 12px rgba(240,196,106,.4)',
                }}
              >
                <span className="text-[10px] font-medium leading-none">{label}</span>
                <span className="mt-0.5 h-1 w-1 rounded-full bg-[var(--color-gold)]" />
              </div>
            );
          }
          return (
            <div
              key={day}
              className="flex aspect-square items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-bg-subtle)] text-[10px] text-[var(--color-fg-subtle)] opacity-60"
            >
              {label}
            </div>
          );
        })}
      </div>

      <a
        href="/play/streak"
        className="mt-3 block w-full rounded-[var(--radius-sm)] py-2 text-center text-[12px] font-medium transition-transform duration-200 hover:-translate-y-0.5"
        style={{
          background: claimedToday ? 'var(--color-bg-subtle)' : 'var(--gradient-gold)',
          boxShadow: claimedToday ? 'none' : '0 0 16px rgba(240,196,106,.35)',
          color: claimedToday ? 'var(--color-fg-muted)' : 'var(--color-accent-fg)',
        }}
      >
        {claimedToday ? 'Ya reclamaste hoy' : `Reclamar día ${nextDay}`}
      </a>
    </section>
  );
}
