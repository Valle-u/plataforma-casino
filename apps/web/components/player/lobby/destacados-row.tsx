'use client';

/**
 * DestacadosRow — los juegos que el operador marcó como destacados.
 *
 * **Por qué existe.** El campo `featured` ya estaba en el modelo y el panel ya
 * dejaba marcarlo, pero la home no lo miraba: marcar un juego como destacado no
 * cambiaba nada en la pantalla del jugador. Era una palanca desconectada.
 *
 * Y hace falta algo arriba de la grilla: un casino sin banners configurados
 * arrancaba directamente en el buscador, con la página medio vacía.
 *
 * **Se esconde solo.** Sin juegos marcados no renderiza nada — ni el título.
 * Un encabezado "Destacados" sobre un espacio vacío se lee como que algo se
 * rompió; que no esté se lee como que no hay, que es la verdad.
 *
 * Mientras carga tampoco muestra nada, a propósito: es una fila secundaria y
 * un esqueleto acá le robaría atención a la grilla, que es lo que la persona
 * vino a ver. El caso del banner es distinto —ocupa media pantalla y su
 * ausencia hace saltar todo— y por eso ahí sí hay placeholder.
 */

import { HomeGameCard } from '@/components/player/home-game-card';
import { useActiveGames } from '@/lib/hooks/use-games';
import { useIsDesktop } from '@/lib/hooks/use-is-desktop';

/** Una fila en desktop (6 columnas) y tres en mobile (2 columnas). */
const CUANTOS = 6;

export function DestacadosRow({
  onGameClick,
}: {
  onGameClick: (code: string) => void;
}) {
  const isDesktop = useIsDesktop();
  const { data } = useActiveGames({ featuredOnly: true, limit: CUANTOS });

  const juegos = data?.data ?? [];
  if (juegos.length === 0) return null;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-display text-[19px] font-bold tracking-[-0.01em] text-[var(--color-fg)]">
        Destacados
      </h2>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {juegos.map((game) => (
          <HomeGameCard
            key={game.id}
            game={game}
            onPlay={onGameClick}
            isDesktop={isDesktop}
          />
        ))}
      </div>
    </section>
  );
}
