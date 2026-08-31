/**
 * HomeGameCard — LA card de juego del jugador: la usan la home (/play) y el
 *
 * lobby (/play/lobby).
 *
 * Nació en el Sprint 54 solo para la home, rediseñada para gente grande. El
 * lobby tenía la suya, más "casino premium". Tener dos hacía que pasar de una
 * sección a la otra se sintiera como cambiar de sitio, así que se unificó — y
 * se unificó hacia ESTA, que es la accesible:
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
 *   - Los no jugables se marcan "Próximamente" con el MISMO criterio: texto
 *     legible sobre la imagen atenuada, sin el overlay pesado que tenía el
 *     lobby. La home no los lista; el lobby sí, por eso el estado existe.
 *
 * Props:
 *   game        — PlayerGame del backend.
 *   unavailable — el juego no se puede abrir todavía ("Próximamente").
 *
 * Sigue sin exponer variantes de ESTILO a propósito: si una sección necesita
 * verse distinta, la pregunta es por qué debería verse distinta.
 */

'use client';

import Link from 'next/link';
import Image from 'next/image';
import type { PlayerGame, GameCategory } from '@/lib/hooks/use-games';
import { useGameProviders } from '@/lib/hooks/use-games';
import { Play } from 'lucide-react';
import { cn } from '@/lib/cn';

const CATEGORY_ACCENT: Partial<Record<GameCategory, string>> = {
  slots: '#FFD700',
  crash: '#FF6B35',
  live: '#C53030',
};

// Ventana para el badge "NUEVO": juegos creados en los últimos 21 días. Se
// deriva de `createdAt` (dato existente) — cero back nuevo.
const NEW_WINDOW_MS = 21 * 24 * 60 * 60 * 1000;

export function HomeGameCard({
  game,
  onPlay,
  isDesktop,
  unavailable = false,
}: {
  game: PlayerGame;
  /**
   * El juego no se puede abrir todavía. El lobby lista juegos que el
   * proveedor todavía no habilitó; la home directamente no los muestra.
   */
  unavailable?: boolean;
  /** Handler de click (desktop → abre el modal, igual que el lobby). Si no se
   *  pasa, el card cae al Link directo al iframe (comportamiento previo). */
  onPlay?: (code: string) => void;
  isDesktop?: boolean;
}) {
  const categoryAccent = CATEGORY_ACCENT[game.category] ?? '#888';

  // Badge (opcional, arriba a la izquierda): HOT si el juego está destacado,
  // sino NUEVO si se creó hace poco. Ambos derivados de datos existentes.
  const isHot = game.featured;
  const isNew =
    !isHot &&
    !!game.createdAt &&
    Date.now() - new Date(game.createdAt).getTime() < NEW_WINDOW_MS;

  // Nombre oficial del estudio (Pragmatic, Sprite, …) por palaceProviderId.
  const providers = useGameProviders();
  const studioName =
    game.palaceProviderId != null
      ? providers.data?.providers?.[game.palaceProviderId]
      : undefined;

  const className = cn(
    'group flex flex-col gap-2',
    'rounded-[var(--radius-lg)]',
    'transition-all duration-300',
    // Un juego que no se puede abrir no se levanta ni brilla al pasar por
    // encima: prometer interacción y no cumplirla confunde más que informar.
    !unavailable &&
      'hover:-translate-y-1.5 hover:shadow-[0_16px_44px_-12px_var(--card-glow)]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]',
  );
  const style = {
    '--card-accent': categoryAccent,
    '--card-glow': `${categoryAccent}80`,
  } as React.CSSProperties;

  const inner = (
    <>
      {/* Thumbnail wrapper — fondo oscuro + object-contain para que TODAS
          las thumbs (distintas relaciones de aspecto por proveedor) se vean
          completas y con el mismo encuadre, sin recortes que agrandan o
          cortan el arte. */}
      <div
        className={cn(
          'relative w-full aspect-[4/3] overflow-hidden rounded-[var(--radius-lg)]',
          'border border-[var(--color-border)] bg-[var(--color-bg-elevated)] transition-colors duration-300',
          'shadow-[0_12px_30px_-14px_rgba(0,0,0,0.9)]',
          'group-hover:border-[var(--card-accent)]',
        )}
      >
        {game.thumbnailUrl ? (
          <Image
            src={game.thumbnailUrl}
            alt={game.name}
            fill
            sizes="(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 16vw"
            className="object-contain transition-transform duration-300 group-hover:scale-105"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <ThumbFallback game={game} />
        )}

        {/* Badge HOT / NUEVO (opcional) */}
        {(isHot || isNew) && (
          <span
            className="absolute left-2 top-2 inline-flex items-center rounded-[6px] px-1.5 py-1 text-[9px] font-bold uppercase leading-none tracking-[0.08em]"
            style={
              isHot
                ? { background: 'var(--color-accent)', color: 'var(--color-accent-fg)' }
                : { background: 'var(--color-cyan)', color: '#04121a' }
            }
          >
            {isHot ? 'Hot' : 'Nuevo'}
          </span>
        )}

        {unavailable ? (
          /*
            "Próximamente" con el mismo criterio que el resto de la card:
            texto grande y legible sobre la imagen atenuada, no un candado
            chiquito. El jugador tiene que entender de un vistazo por qué no
            puede entrar, sin forzar la vista.
          */
          <div className="absolute inset-0 flex items-center justify-center bg-[rgba(4,6,14,.72)] px-2">
            <span className="text-center text-[13px] font-medium leading-tight text-[var(--color-fg)]">
              Próximamente
            </span>
          </div>
        ) : (
          /* Overlay de play al pasar por encima (solo si se puede jugar). */
          <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-all duration-300">
            <div className="size-12 rounded-full bg-white/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 scale-75 group-hover:scale-100 shadow-lg">
              <Play className="size-6 text-black ml-0.5" fill="currentColor" />
            </div>
          </div>
        )}
      </div>

      {/* Nombre + estudio */}
      <div className="flex flex-col gap-0.5 px-1 pb-1">
        <span className="block truncate text-[15px] sm:text-[16px] font-medium leading-snug text-[var(--color-fg)]">
          {game.name}
        </span>
        {studioName && (
          <span className="block truncate text-[11px] leading-none text-[var(--color-fg-muted)]">
            {studioName}
          </span>
        )}
      </div>
    </>
  );

  // Desktop con handler → botón que abre el modal (misma experiencia que el
  // lobby). Mobile o sin handler → Link directo al iframe (como antes).
  // No jugable: ni botón ni link. Un card que no lleva a ningún lado no debe
  // ser clickeable -- tocarlo y que no pase nada se lee como que la página
  // está rota, sobre todo para alguien que no da por sentado que "no anda"
  // significa "todavía no está".
  if (unavailable) {
    return (
      <div className={className} style={style} aria-label={`${game.name} — próximamente`}>
        {inner}
      </div>
    );
  }

  if (isDesktop && onPlay) {
    return (
      <button
        type="button"
        onClick={() => onPlay(game.code)}
        className={cn(className, 'w-full text-left')}
        style={style}
        aria-label={`Jugar ${game.name}`}
      >
        {inner}
      </button>
    );
  }

  return (
    <Link
      href={`/play/games/${game.code}/play/iframe`}
      className={className}
      style={style}
    >
      {inner}
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
