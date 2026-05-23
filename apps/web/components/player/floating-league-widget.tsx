/**
 * FloatingLeagueWidget — Sprint 51.11.
 *
 * Burbuja flotante (FAB-style) en bottom-right de TODAS las páginas
 * `/play/*` que muestra al instante la posición del player en la liga
 * activa + premio si está en zona, con tap para expandir a modal con
 * top 10 + ventana around.
 *
 * Por qué un widget global:
 *   - Dopamine constante: el player ve su rank en cada página, lo
 *     incentiva a "subir uno más" antes de irse.
 *   - Discoverabilidad: muchas plataformas tienen ligas y el player
 *     no sabe. Un widget visible las pone front-and-center.
 *   - Mobile-first: ocupa poco real estate, no compite con bottom nav
 *     (se ubica 80px arriba de éste).
 *
 * Estados:
 *   - Sin liga activa → no render.
 *   - Player NO en ranking → "Sin posición" en gris, tap muestra
 *     top 10 + CTA "Apostá para entrar".
 *   - Player en top 10 → "Vas #N°" highlight color trofeo (oro/plata/
 *     bronce para 1-2-3, accent para 4-10).
 *   - Player fuera de top 10 pero en standings → "Vas #N° · 2 atrás"
 *     mostrando gap al rango premiado.
 *
 * Layout:
 *   - Mobile: fixed bottom-20 right-3 (above bottom nav).
 *   - Desktop: fixed bottom-6 right-6.
 *   - Modal: full-screen drawer en mobile, centered modal en desktop.
 *
 * Performance: refetch interval 30s (similar a notifs bell). El polling
 * es ligero — el cron `LeaguesRecomputeCron` recomputa cada 5min, así
 * que 30s del client garantiza ver el cambio dentro de 1 ciclo.
 */

'use client';

import { Trophy, X, Crown, Medal, Award } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import {
  useLeagues,
  useLeagueStandings,
  type LeagueRow,
  type StandingRow,
} from '@/lib/hooks/use-leagues';
import { cn } from '@/lib/cn';

export function FloatingLeagueWidget() {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();

  // Leemos solo activas. Tomamos la primera (si hay múltiples ligas,
  // futuro: dejar al admin marcar una "featured").
  const activeLeagues = useLeagues({ status: 'active', limit: 1 });
  const league = activeLeagues.data?.data[0];

  // No render si no hay liga ni user.
  if (!league || !user) return null;

  return (
    <>
      <LeagueFab league={league} userId={user.id} onClick={() => setOpen(true)} />
      {open && (
        <LeagueModal
          league={league}
          userId={user.id}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// FAB — el botón flotante
// ──────────────────────────────────────────────────────────────────────

function LeagueFab({
  league,
  userId,
  onClick,
}: {
  league: LeagueRow;
  userId: string;
  onClick: () => void;
}) {
  // Pedimos top 25 — suficiente para encontrar al user en la mayoría
  // de los casos. Si no, el endpoint también devuelve `around` con
  // su posición específica.
  const standings = useLeagueStandings(league.id, 25);
  const top = standings.data?.top ?? [];
  const around = standings.data?.around ?? [];
  const total = standings.data?.total ?? 0;

  // ¿El user está en top o en around?
  const myRowInTop = top.find((r) => r.userId === userId);
  const myRowInAround = around.find((r) => r.userId === userId);
  const myRow = myRowInTop ?? myRowInAround;

  const position = myRow?.position ?? null;
  const variant = getPositionVariant(position);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'fixed z-30 transition-all duration-200',
        // Mobile: arriba del bottom nav (h-16 nav + safe-area + breathing room).
        'bottom-[5.5rem] right-3',
        // Desktop: bottom-right tradicional.
        'md:bottom-6 md:right-6',
        // Pill shape: alto fijo, ancho fluído por contenido.
        'flex items-center gap-2 pl-2.5 pr-3 h-12',
        'border-2 rounded-full',
        'bg-[var(--color-bg-elevated)] backdrop-blur-md',
        'shadow-lg hover:shadow-xl',
        'active:scale-95',
        variant.borderClass,
      )}
      style={variant.glow ? { boxShadow: variant.glow } : undefined}
      aria-label={
        position
          ? `Vas en posición ${position} de la liga`
          : 'Ver liga activa'
      }
    >
      {/* Icono trofeo color por rank */}
      <div
        className={cn(
          'flex items-center justify-center size-8 rounded-full shrink-0',
          variant.iconBgClass,
        )}
      >
        <variant.Icon className={cn('size-4', variant.iconClass)} />
      </div>
      {/* Texto compacto */}
      <div className="flex flex-col items-start leading-none">
        <span className="text-[9px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] font-medium">
          Liga
        </span>
        <span
          className={cn(
            'text-[13px] font-display tabular-nums tracking-tight',
            variant.labelClass,
          )}
        >
          {position ? `#${position}` : `${total}+`}
        </span>
      </div>
    </button>
  );
}

interface PositionVariant {
  borderClass: string;
  iconBgClass: string;
  iconClass: string;
  labelClass: string;
  glow?: string;
  Icon: typeof Trophy;
}

function getPositionVariant(position: number | null): PositionVariant {
  if (position === 1) {
    // Oro
    return {
      borderClass: 'border-[#FFD700]',
      iconBgClass: 'bg-[#FFD700]/20',
      iconClass: 'text-[#FFD700]',
      labelClass: 'text-[#FFD700]',
      glow: '0 0 20px rgba(255,215,0,0.45)',
      Icon: Crown,
    };
  }
  if (position === 2) {
    // Plata
    return {
      borderClass: 'border-[#C0C0C0]',
      iconBgClass: 'bg-[#C0C0C0]/20',
      iconClass: 'text-[#C0C0C0]',
      labelClass: 'text-[#C0C0C0]',
      glow: '0 0 15px rgba(192,192,192,0.4)',
      Icon: Medal,
    };
  }
  if (position === 3) {
    // Bronce
    return {
      borderClass: 'border-[#CD7F32]',
      iconBgClass: 'bg-[#CD7F32]/20',
      iconClass: 'text-[#CD7F32]',
      labelClass: 'text-[#CD7F32]',
      glow: '0 0 15px rgba(205,127,50,0.4)',
      Icon: Award,
    };
  }
  if (position !== null && position <= 10) {
    // Top 10: accent
    return {
      borderClass: 'border-[var(--color-accent)]',
      iconBgClass: 'bg-[var(--color-accent-subtle)]',
      iconClass: 'text-[var(--color-accent-text)]',
      labelClass: 'text-[var(--color-fg)]',
      glow: '0 0 15px var(--color-accent-glow)',
      Icon: Trophy,
    };
  }
  // Sin top o sin posición
  return {
    borderClass: 'border-[var(--color-border-strong)]',
    iconBgClass: 'bg-[var(--color-bg-subtle)]',
    iconClass: 'text-[var(--color-fg-muted)]',
    labelClass: 'text-[var(--color-fg-muted)]',
    Icon: Trophy,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Modal — full standings + posición del player
// ──────────────────────────────────────────────────────────────────────

function LeagueModal({
  league,
  userId,
  onClose,
}: {
  league: LeagueRow;
  userId: string;
  onClose: () => void;
}) {
  const standings = useLeagueStandings(league.id, 10);
  const top = standings.data?.top ?? [];
  const around = standings.data?.around ?? [];
  const total = standings.data?.total ?? 0;
  const myRowInTop = top.find((r) => r.userId === userId);
  const myRowInAround = around.find((r) => r.userId === userId);
  const myPosition = (myRowInTop ?? myRowInAround)?.position ?? null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-6 animate-fade-up"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full md:max-w-md bg-[var(--color-bg-elevated)] border border-[var(--color-border-strong)] rounded-t-2xl md:rounded-2xl overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-[var(--color-border)]">
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-[var(--color-accent-text)] font-medium">
              <Trophy className="size-3" />
              Liga activa
            </div>
            <h2 className="font-display text-xl tracking-tight text-[var(--color-fg)] truncate">
              {league.name}
            </h2>
            <p className="text-[11px] text-[var(--color-fg-subtle)]">
              {total} participantes ·{' '}
              <span className="font-mono">{METRIC_LABEL[league.metric] ?? league.metric}</span>
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

        {/* Mi posición — si el user está en standings */}
        {myPosition !== null && (
          <div className="px-5 py-4 bg-[var(--color-accent-subtle)] border-b border-[var(--color-accent)]">
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-accent-text)] font-medium">
                  Tu posición
                </span>
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-3xl tabular-nums tracking-tight text-[var(--color-fg)]">
                    #{myPosition}
                  </span>
                  <span className="text-[11px] text-[var(--color-fg-muted)]">
                    de {total}
                  </span>
                </div>
              </div>
              {myPosition <= 3 ? (
                <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-accent-text)] font-medium text-right">
                  Zona de
                  <br />
                  premio
                </div>
              ) : myPosition <= 10 ? (
                <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-muted)] font-medium text-right">
                  Top 10
                </div>
              ) : (
                <div className="text-[10px] text-[var(--color-fg-muted)] text-right max-w-[140px]">
                  Subí más para entrar al top 10 y ganar premios
                </div>
              )}
            </div>
          </div>
        )}

        {!myPosition && (
          <div className="px-5 py-4 bg-[var(--color-bg)] border-b border-[var(--color-border)] text-center">
            <p className="text-[12px] text-[var(--color-fg-muted)]">
              Todavía no estás en el ranking. Apostá para sumar puntos y
              competir.
            </p>
          </div>
        )}

        {/* Top 10 */}
        <div className="overflow-y-auto flex-1">
          {standings.isLoading ? (
            <div className="p-8 text-center text-[12px] text-[var(--color-fg-subtle)]">
              Cargando standings…
            </div>
          ) : top.length === 0 ? (
            <div className="p-8 text-center text-[12px] text-[var(--color-fg-subtle)]">
              Sin participantes todavía. ¡Sé el primero!
            </div>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {top.map((row) => (
                <StandingRow
                  key={row.userId}
                  row={row}
                  isMe={row.userId === userId}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function StandingRow({ row, isMe }: { row: StandingRow; isMe: boolean }) {
  const variant = getPositionVariant(row.position);
  return (
    <li
      className={cn(
        'flex items-center gap-3 px-5 py-3',
        isMe && 'bg-[var(--color-accent-subtle)]',
      )}
    >
      {/* Position badge */}
      <div
        className={cn(
          'flex items-center justify-center size-9 rounded-full shrink-0 border-2',
          row.position <= 3 ? variant.borderClass : 'border-transparent',
          row.position <= 3
            ? variant.iconBgClass
            : 'bg-[var(--color-bg-subtle)]',
        )}
      >
        {row.position <= 3 ? (
          <variant.Icon className={cn('size-4', variant.iconClass)} />
        ) : (
          <span className="text-[12px] font-mono tabular-nums text-[var(--color-fg-muted)]">
            {row.position}
          </span>
        )}
      </div>
      {/* Name + username */}
      <div className="flex flex-col min-w-0 flex-1">
        <span
          className={cn(
            'text-[13px] truncate',
            isMe ? 'text-[var(--color-fg)] font-medium' : 'text-[var(--color-fg)]',
          )}
        >
          {row.displayName ?? row.username ?? row.userId.slice(0, 13)}
          {isMe && (
            <span className="ml-1.5 text-[10px] uppercase tracking-[0.1em] text-[var(--color-accent-text)]">
              vos
            </span>
          )}
        </span>
        {row.username && row.displayName && (
          <span className="text-[10px] font-mono text-[var(--color-fg-subtle)] truncate">
            @{row.username}
          </span>
        )}
      </div>
      {/* Score */}
      <span className="text-[13px] font-mono tabular-nums text-[var(--color-fg)] shrink-0">
        {row.score}
      </span>
    </li>
  );
}

const METRIC_LABEL: Record<string, string> = {
  bet_volume: 'volumen de apuestas',
  rounds_count: 'cantidad de rondas',
  gross_won: 'premios brutos',
  player_netwin: 'ganancia neta',
  score_custom: 'score',
};
