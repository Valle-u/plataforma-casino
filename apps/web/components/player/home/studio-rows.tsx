'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { HomeGameCard } from '@/components/player/home-game-card';
import {
  useActiveGames,
  useGameFacets,
  useGameProviders,
} from '@/lib/hooks/use-games';

/**
 * StudioRows — secciones de la home separadas POR ESTUDIO (Pragmatic, BGaming,
 * etc.). Una fila horizontal por estudio, ordenadas por cantidad de juegos.
 *
 * Se arma de `/tenant/games/facets` (estudios + conteo real) + los nombres
 * oficiales de `/tenant/games/providers`. Solo se muestran los estudios que
 * tienen NOMBRE: si Palace todavía no devuelve nombres (ej. la IP del server no
 * está autorizada) no se renderiza nada — la sección "se enciende" sola cuando
 * llegan los nombres. Cada fila linkea a `/play/lobby?studio=<id>` (el lobby lo
 * lee para pre-seleccionar el filtro de estudio).
 */

const MAX_STUDIO_ROWS = 6;
const GAMES_PER_ROW = 14;

interface Studio {
  id: number;
  name: string;
  count: number;
}

export function StudioRows() {
  const facets = useGameFacets();
  const providers = useGameProviders();
  const nameMap = providers.data?.providers ?? {};

  const studios = useMemo<Studio[]>(() => {
    const raw = facets.data?.studios ?? [];
    const out: Studio[] = [];
    for (const s of raw) {
      if (s.palaceProviderId == null) continue;
      const name = nameMap[s.palaceProviderId]?.trim();
      if (!name) continue;
      out.push({ id: s.palaceProviderId, name, count: s.count });
    }
    return out.sort((a, b) => b.count - a.count).slice(0, MAX_STUDIO_ROWS);
  }, [facets.data, nameMap]);

  if (studios.length === 0) return null;

  return (
    <>
      {studios.map((s) => (
        <StudioRow key={s.id} studio={s} />
      ))}
    </>
  );
}

function StudioRow({ studio }: { studio: Studio }) {
  const query = useActiveGames({
    providerId: studio.id,
    limit: GAMES_PER_ROW,
  });
  const games = query.data?.data ?? [];

  if (!query.isLoading && games.length === 0) return null;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="min-w-0 truncate font-display text-[24px]">
          {studio.name}
          <span className="ml-2 align-middle text-[14px] text-[var(--color-fg-subtle)]">
            {studio.count}
          </span>
        </h2>
        <Link
          href={`/play/lobby?studio=${studio.id}`}
          className="shrink-0 text-[13px] text-[var(--color-accent-text)] transition-opacity hover:opacity-80"
        >
          Ver todo →
        </Link>
      </div>

      {query.isLoading ? (
        <RowSkeleton />
      ) : (
        <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0 [-ms-overflow-style:none] [scrollbar-width:thin]">
          {games.map((game) => (
            <div
              key={game.id}
              className="w-[42%] shrink-0 snap-start sm:w-[180px] lg:w-[190px]"
            >
              <HomeGameCard game={game} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function RowSkeleton() {
  return (
    <div className="-mx-4 flex gap-3 overflow-hidden px-4 sm:mx-0 sm:px-0">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="w-[42%] shrink-0 sm:w-[180px] lg:w-[190px]"
        >
          <div className="aspect-[4/3] w-full animate-pulse rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)]" />
        </div>
      ))}
    </div>
  );
}
