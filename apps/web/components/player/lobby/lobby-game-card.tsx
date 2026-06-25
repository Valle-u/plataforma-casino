'use client';

import Link from 'next/link';

/**
 * LobbyGameCard — card de juego para la grilla "Todos los juegos" del
 * lobby (rediseño Neón Milonga). Vertical (3:4), arte de gradiente neón
 * tinteado por props.accent, badges de categoría/HOT y pie con título +
 * jugadores en vivo.
 *
 * La envoltura es un Link a props.href ?? '#'.
 */

interface LobbyGameCardProps {
  title: string;
  categoryLabel: string;
  players: number;
  hot?: boolean;
  /** Color de acento neón para tintar el arte (ej. '#7b2ff7', '#ff3ec9'). */
  accent: string;
  href?: string;
}

const numberFormatter = new Intl.NumberFormat('es-AR');

export function LobbyGameCard({
  title,
  categoryLabel,
  players,
  hot = false,
  accent,
  href,
}: LobbyGameCardProps) {
  return (
    <Link
      href={href ?? '#'}
      className="group relative block aspect-[3/4] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] transition duration-[.25s] hover:-translate-y-1.5 hover:border-[var(--color-cyan)] hover:shadow-[0_12px_30px_rgba(46,155,255,.45)]"
    >
      {/* ARTE — gradiente neón base tinteado por accent */}
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(135deg, color-mix(in srgb, ${accent} 85%, #04060e) 0%, #060a16 70%)`,
        }}
      />

      {/* Bandas diagonales decorativas (chevron sutil) */}
      <div
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background: `repeating-linear-gradient(135deg, transparent 0px, transparent 26px, color-mix(in srgb, ${accent} 22%, transparent) 26px, color-mix(in srgb, ${accent} 22%, transparent) 28px)`,
          maskImage:
            'linear-gradient(135deg, rgba(0,0,0,.9) 0%, transparent 55%)',
          WebkitMaskImage:
            'linear-gradient(135deg, rgba(0,0,0,.9) 0%, transparent 55%)',
        }}
      />

      {/* Halo de glow del accent al hacer hover */}
      <div
        className="pointer-events-none absolute -inset-8 opacity-0 transition-opacity duration-[.25s] group-hover:opacity-50"
        style={{
          background: `radial-gradient(circle at 50% 30%, color-mix(in srgb, ${accent} 60%, transparent) 0%, transparent 60%)`,
        }}
      />

      {/* BADGE categoría — arriba izquierda */}
      <span className="absolute left-2 top-2 z-10 rounded-full bg-black/55 px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-fg)] backdrop-blur">
        {categoryLabel}
      </span>

      {/* BADGE HOT — arriba derecha (condicional) */}
      {hot && (
        <span
          className="absolute right-2 top-2 z-10 rounded-full bg-[var(--color-magenta)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--color-fg)] shadow-[0_0_14px_rgba(255,62,201,.6)]"
        >
          HOT
        </span>
      )}

      {/* PIE — overlay con gradiente negro hacia arriba para legibilidad */}
      <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-3 pb-3 pt-8">
        <h3 className="font-display text-[15px] leading-tight text-[var(--color-fg)]">
          {title}
        </h3>
        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--color-fg-subtle)]">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-success)] shadow-[0_0_6px_rgba(57,211,83,.8)]" />
          <span className="tabular-nums">{numberFormatter.format(players)}</span>{' '}
          jugando
        </p>
      </div>
    </Link>
  );
}
