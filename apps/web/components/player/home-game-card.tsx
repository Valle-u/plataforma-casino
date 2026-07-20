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
import { cn } from '@/lib/cn';

const CATEGORY_LABEL: Record<GameCategory, string> = {
  slots: 'Slots',
  crash: 'Crash',
  table: 'Mesa',
  live: 'En vivo',
  mini: 'Mini',
};

const CATEGORY_ACCENT: Record<GameCategory, string> = {
  slots: '#FFD700',
  crash: '#FF6B35',
  table: '#00e5ff',
  live: '#C53030',
  mini: '#FFA500',
};

export function HomeGameCard({ game }: { game: PlayerGame }) {
  const categoryAccent = CATEGORY_ACCENT[game.category];

  return (
    <Link
      href={`/play/games/${game.code}/play/iframe`}
      className={cn(
        'group flex flex-col gap-3 p-2',
        'card-premium rounded-[var(--radius-lg)]',
        'transition-colors duration-150',
        'hover:border-[color:var(--card-accent)]',
        'active:scale-[0.98]',
      )}
      style={
        {
          '--card-accent': categoryAccent,
        } as React.CSSProperties
      }
    >
      {/* Thumbnail — aspect 4:3 para que sea menos vertical que el lobby
        * (que usa 1:1). Más compacto en la home. */}
      <div
        className={cn(
          'relative w-full aspect-[4/3] overflow-hidden rounded-[var(--radius)]',
          'bg-[var(--color-bg-subtle)]',
          'flex items-center justify-center',
        )}
      >
        {game.thumbnailUrl ? (

          <img
            src={game.thumbnailUrl}
            alt={game.name}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <ThumbFallback game={game} />
        )}

        {/* Pill de categoría — grande y legible, no la mini-uppercase */}
        <span
          className="absolute top-2 left-2 px-2.5 h-7 inline-flex items-center text-[12px] font-medium rounded-full"
          style={{
            background: `${categoryAccent}e6`,
            color: '#fff',
          }}
        >
          {CATEGORY_LABEL[game.category]}
        </span>
      </div>

      {/* Nombre — fuera de la thumb, no overlay. 16px legible. */}
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
