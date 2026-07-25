/**
 * HomeGameCard — card de juego para el dashboard simplificado de /play.
 *
 * Sprint 54: home rediseñada para gente grande. Diferencias deliberadas
 * con el GameCard del /play/lobby:
 *
 *   - SIN hover tilt 3D, SIN shimmer, SIN slide-up con descripción.
 *     Esos efectos están bien en el lobby (vibe "casino premium") pero
 *     en la home distraen al usuario mayor que solo quiere apretar y
 *     jugar.
 *   - Nombre del juego en texto GRANDE debajo de la thumb (16px), no
 *     como overlay encima de gradient — más legible para vista cansada.
 *   - Pill de categoría más grande (12px vs 9px) y sin uppercase
 *     condensado.
 *   - Tap target todo el card es ≥120px alto incluyendo nombre.
 *   - Sin overlay "Próximamente" pesado: los no-playables simplemente
 *     no se muestran en home (el lobby sí los lista).
 *
 * Props:
 *   game — PlayerGame del backend.
 *
 * No expone variants. Si la home necesita una versión distinta en el
 * futuro, crear otra card en vez de meter complejidad acá.
 */

'use client';

import Link from 'next/link';
import type { PlayerGame, GameCategory } from '@/lib/hooks/use-games';
import { Play } from 'lucide-react';
import { cn } from '@/lib/cn';

const CATEGORY_LABEL: Partial<Record<GameCategory, string>> = {
  slots: 'Slots',
  crash: 'Crash',
  live: 'En vivo',
};

const CATEGORY_ACCENT: Partial<Record<GameCategory, string>> = {
  slots: '#FFD700',
  crash: '#FF6B35',
  live: '#C53030',
};

export function HomeGameCard({ game }: { game: PlayerGame }) {
  const categoryAccent = CATEGORY_ACCENT[game.category] ?? '#888';
  const categoryLabel = CATEGORY_LABEL[game.category] ?? game.category;

  return (
    <Link
      href={`/play/games/${game.code}/play`}
      className={cn(
        'group flex flex-col gap-2',
        'rounded-[var(--radius-lg)]',
        'transition-all duration-300',
        'hover:-translate-y-1.5 hover:shadow-[0_16px_44px_-12px_var(--card-glow)]',
      )}
      style={
        {
          '--card-accent': categoryAccent,
          '--card-glow': `${categoryAccent}80`,
        } as React.CSSProperties
      }
    >
      {/* Thumbnail wrapper */}
      <div
        className={cn(
          'relative w-full aspect-[4/3] overflow-hidden rounded-[var(--radius-lg)]',
          'border border-[var(--color-border)] transition-colors duration-300',
          'group-hover:border-[var(--card-accent)]',
        )}
      >
        {game.thumbnailUrl ? (
          <img
            src={game.thumbnailUrl}
            alt={game.name}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <ThumbFallback game={game} />
        )}

        {/* Pill de categoría */}
        <span
          className="absolute top-2 left-2 px-2.5 h-7 inline-flex items-center text-[12px] font-medium rounded-full"
          style={{
            background: `${categoryAccent}e6`,
            color: '#fff',
          }}
        >
          {categoryLabel}
        </span>

        {/* Play overlay on hover */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-all duration-300">
          <div className="size-12 rounded-full bg-white/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 scale-75 group-hover:scale-100 shadow-lg">
            <Play className="size-6 text-black ml-0.5" fill="currentColor" />
          </div>
        </div>
      </div>

      {/* Nombre */}
      <div className="px-1 pb-1">
        <span className="block text-[16px] sm:text-[17px] font-medium text-[var(--color-fg)] truncate leading-snug">
          {game.name}
        </span>
      </div>
    </Link>
  );
}

/**
 * Fallback cuando el juego no trae thumbnailUrl. Iniciales sobre fondo
 * coloreado por categoría. Mucho menos elaborado que el ThumbPlaceholder
 * del lobby (que tiene patrones SVG, etc.) — acá lo simple gana.
 */
function ThumbFallback({ game }: { game: PlayerGame }) {
  const accent = CATEGORY_ACCENT[game.category];
  const initials = game.name
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{
        background: `linear-gradient(135deg, ${accent}33 0%, ${accent}11 100%)`,
      }}
    >
      <span
        className="text-4xl font-display font-medium"
        style={{ color: accent }}
      >
        {initials}
      </span>
    </div>
  );
}
