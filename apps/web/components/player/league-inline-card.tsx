/**
 * LeagueInlineCard — Sprint 51.17.
 *
 * Versión "permanente y visible" del FloatingLeagueWidget. Mientras el
 * FAB flotante muestra solo tu posición compacta, este card inline (usado
 * en el home) muestra:
 *
 *   - Tu posición destacada (gold/silver/bronze/accent según rank).
 *   - Top 5 del podio para social proof — "fulano vas atrás suyo".
 *   - Progress visual: gap al puesto inmediato superior.
 *   - CTA "Ver liga completa" → abre el mismo modal del FAB.
 *
 * Mostrar standings inline en el home es uno de los drivers más fuertes
 * de retención en plataformas freemium: el player ve quién está arriba
 * suyo y siente la "casi-victoria" → vuelve a jugar para superarlo.
 *
 * Si no hay liga activa, el card no renderiza (mismo comportamiento que
 * el FAB).
 */

'use client';

import { Award, ChevronRight, Crown, Medal, Trophy } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import {
  useLeagues,
  useLeagueStandings,
  type StandingRow,
} from '@/lib/hooks/use-leagues';
import { cn } from '@/lib/cn';

export function LeagueInlineCard() {
  const { user } = useAuth();
  const activeLeagues = useLeagues({ status: 'active', limit: 1 });
  const league = activeLeagues.data?.data[0];
  const standings = useLeagueStandings(league?.id ?? null, 5);

  if (!user || !league) return null;

  const top = standings.data?.top ?? [];
  const around = standings.data?.around ?? [];
  const total = standings.data?.total ?? 0;
  const myRow =
    top.find((r) => r.userId === user.id) ??
    around.find((r) => r.userId === user.id) ??
    null;
  const myPosition = myRow?.position ?? null;

  // Gap al puesto inmediato superior — texto del tipo "+200 para subir"
  // si lo tenemos en standings, sino oculto.
  let gapText: string | null = null;
  if (myPosition && myPosition > 1) {
    const myCombined = [...top, ...around].find((r) => r.userId === user.id);
    const aboveCombined = [...top, ...around].find(
      (r) => r.position === myPosition - 1,
    );
    if (myCombined && aboveCombined) {
      const gap = Number(aboveCombined.score) - Number(myCombined.score);
      if (gap > 0) {
        gapText = `+${gap.toLocaleString('es-AR')} para subir al #${myPosition - 1}`;
      }
    }
  }

  return (
    <section
      className="relative animate-fade-up"
      style={{ animationDelay: '200ms', animationFillMode: 'both' }}
    >
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[10px] sm:text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-medium flex items-center gap-1.5">
          <Trophy className="size-3 text-[#FFD700]" />
          Liga activa
        </h2>
        <Link
          href="/play/lobby"
          className="text-[10px] sm:text-[11px] text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] uppercase tracking-[0.08em] transition-colors"
        >
          Ver liga →
        </Link>
      </div>

      <div className="relative overflow-hidden border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)]">
        {/* Imagen de fondo league.png con luminosity desaturada */}
        <picture aria-hidden>
          <source srcSet="/hero/league.avif" type="image/avif" />
          <source srcSet="/hero/league.webp" type="image/webp" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/hero/league.webp"
            alt=""
            className="absolute inset-0 w-full h-full object-cover opacity-20 mix-blend-luminosity"
          />
        </picture>
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(135deg, rgba(18,18,18,0.95) 0%, rgba(18,18,18,0.8) 60%, rgba(18,18,18,0.65) 100%)',
          }}
        />
        <div
          aria-hidden
          className="absolute -inset-x-12 -top-12 h-48 opacity-25 blur-3xl pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse at 80% center, rgba(255,215,0,0.6) 0%, transparent 65%)',
          }}
        />

        <div className="relative grid sm:grid-cols-[1fr_1px_1fr] gap-0">
          {/* ── Bloque izquierdo: tu posición + nombre liga ── */}
          <div className="p-5 sm:p-6 flex flex-col gap-3">
            <div>
              <h3 className="font-display text-lg sm:text-xl tracking-tight text-[var(--color-fg)] truncate">
                {league.name}
              </h3>
              <p className="text-[11px] text-[var(--color-fg-muted)] mt-0.5">
                {total} {total === 1 ? 'participante' : 'participantes'}
              </p>
            </div>

            {myPosition !== null ? (
              <MyPositionBlock position={myPosition} total={total} />
            ) : (
              <div className="flex items-center gap-2 text-[12px] text-[var(--color-fg-muted)]">
                <span>No estás en el ranking todavía. Apostá para sumar.</span>
              </div>
            )}

            {gapText && (
              <p className="text-[11px] text-[var(--color-fg-muted)] mt-1">
                <span className="text-[var(--color-accent-text)] font-medium">
                  {gapText}
                </span>
              </p>
            )}
          </div>

          {/* Divisor vertical solo en sm+ */}
          <div className="hidden sm:block bg-[var(--color-border)]" />

          {/* ── Bloque derecho: top 5 podio ── */}
          <div className="p-5 sm:p-6 border-t sm:border-t-0 border-[var(--color-border)]">
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-medium mb-3">
              Podio
            </div>
            {standings.isLoading ? (
              <div className="text-[12px] text-[var(--color-fg-subtle)] italic">
                Cargando…
              </div>
            ) : top.length === 0 ? (
              <div className="text-[12px] text-[var(--color-fg-subtle)] italic">
                Sin participantes. ¡Sé el primero!
              </div>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {top.slice(0, 5).map((row) => (
                  <PodiumRow
                    key={row.userId}
                    row={row}
                    isMe={row.userId === user.id}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Footer: CTA */}
        <Link
          href="/play/lobby"
          className="relative flex items-center justify-between gap-2 px-5 sm:px-6 py-3 border-t border-[var(--color-border)] text-[12px] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] transition-colors group/footer"
        >
          <span className="font-medium">
            Jugá ahora para sumar puntos
          </span>
          <ChevronRight className="size-3.5 group-hover/footer:translate-x-0.5 transition-transform" />
        </Link>
      </div>
    </section>
  );
}

function MyPositionBlock({
  position,
  total,
}: {
  position: number;
  total: number;
}) {
  const variant = getRankVariant(position);
  const Icon = variant.Icon;
  return (
    <div className="flex items-center gap-3">
      <div
        className="size-14 rounded-full flex items-center justify-center shrink-0 border-2"
        style={{
          background: `linear-gradient(135deg, ${variant.color}30, ${variant.color}08)`,
          borderColor: variant.color,
          boxShadow: `0 0 16px ${variant.color}40`,
        }}
      >
        <Icon className="size-6" style={{ color: variant.color }} />
      </div>
      <div className="flex flex-col gap-0.5 min-w-0">
        <span
          className="text-[10px] uppercase tracking-[0.1em] font-medium"
          style={{ color: variant.color }}
        >
          Vas en
        </span>
        <div className="flex items-baseline gap-2">
          <span
            className="font-display text-3xl sm:text-4xl tabular-nums tracking-tight leading-none"
            style={{ color: variant.color }}
          >
            #{position}
          </span>
          <span className="text-[11px] text-[var(--color-fg-muted)]">
            de {total}
          </span>
        </div>
      </div>
    </div>
  );
}

function PodiumRow({ row, isMe }: { row: StandingRow; isMe: boolean }) {
  const variant = getRankVariant(row.position);
  return (
    <li
      className={cn(
        'flex items-center gap-2 py-1.5 px-2',
        isMe && 'bg-[var(--color-accent-subtle)] -mx-2 px-2',
      )}
    >
      <span
        className="size-6 rounded-full flex items-center justify-center text-[11px] font-mono font-medium shrink-0"
        style={
          row.position <= 3
            ? {
                background: `${variant.color}20`,
                color: variant.color,
                border: `1px solid ${variant.color}50`,
              }
            : { color: 'var(--color-fg-muted)' }
        }
      >
        {row.position}
      </span>
      <span
        className={cn(
          'flex-1 text-[12px] truncate',
          isMe ? 'text-[var(--color-fg)] font-medium' : 'text-[var(--color-fg)]',
        )}
      >
        {row.displayName ?? row.username ?? row.userId.slice(0, 12)}
        {isMe && (
          <span className="ml-1.5 text-[9px] uppercase tracking-[0.1em] text-[var(--color-accent-text)]">
            vos
          </span>
        )}
      </span>
      <span className="text-[11px] font-mono tabular-nums text-[var(--color-fg-muted)] shrink-0">
        {Number(row.score).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
      </span>
    </li>
  );
}

function getRankVariant(position: number): {
  color: string;
  Icon: typeof Trophy;
} {
  if (position === 1) return { color: '#FFD700', Icon: Crown };
  if (position === 2) return { color: '#C0C0C0', Icon: Medal };
  if (position === 3) return { color: '#CD7F32', Icon: Award };
  if (position <= 10) return { color: 'var(--color-accent)', Icon: Trophy };
  return { color: 'var(--color-fg-muted)', Icon: Trophy };
}
