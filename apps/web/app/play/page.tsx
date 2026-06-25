/**
 * /play — Lobby de Casino TANGO (rediseño "Neón Milonga").
 *
 * Lobby de 3 columnas (desktop) inspirado en el handoff de diseño:
 *   - Izquierda  (248px): <LobbySidebar/> — wordmark TANGO + nav + VIP card.
 *   - Centro     (1fr):   topbar + hero + ticker + categorías + grilla de juegos.
 *   - Derecha    (326px): <ChallengesRail/> — liga, misiones, bonos, ruleta, racha.
 *
 * Responsive: en <lg se oculta el sidebar; en <xl se oculta el rail. En esos
 * breakpoints la nav la cubre <PlayerBottomNav/> (montado en play/layout.tsx).
 * El layout NO monta PlayerHeader/Footer en /play (esta home trae su propio
 * chrome) — ver el flag `isHome` en play/layout.tsx.
 *
 * Datos REALES: juegos (useActiveGames), saldo (useMyWallet), iniciales del
 * avatar (useAuth). Los widgets del rail + ticker + jackpot usan datos demo
 * (feed-driven en el diseño; se cablean al backend en una fase posterior).
 */

'use client';

import Link from 'next/link';
import { ChallengesRail } from '@/components/player/lobby/challenges-rail';
import { CategoriesRow } from '@/components/player/lobby/categories-row';
import { LobbyGameCard } from '@/components/player/lobby/lobby-game-card';
import { LobbyHero } from '@/components/player/lobby/lobby-hero';
import { WinnersTicker } from '@/components/player/lobby/winners-ticker';
import { useActiveGames, type GameCategory } from '@/lib/hooks/use-games';

/** category → label visible + color de acento para el arte de la card. */
const CATEGORY_META: Record<GameCategory, { label: string; accent: string }> = {
  slots: { label: 'Slots', accent: 'var(--color-accent)' },
  live: { label: 'En Vivo', accent: 'var(--color-magenta)' },
  crash: { label: 'Crash', accent: 'var(--color-success)' },
  table: { label: 'Cartas', accent: 'var(--color-purple)' },
};

export default function PlayLobbyPage() {
  const gamesQuery = useActiveGames();

  const games = gamesQuery.data?.data ?? [];
  const featured = games.filter((g) => g.featured);

  return (
    /* El sidebar + header los provee el shell (play/layout.tsx). Acá solo
     * va el contenido del lobby + el rail de Retos (exclusivo del lobby). */
    <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_326px]">
      {/* ── Columna central — Main ── */}
      <main className="flex min-w-0 flex-col gap-7 px-4 py-5 sm:px-6 lg:px-8">
        <LobbyHero />
        <WinnersTicker />
        <CategoriesRow />

        {/* Destacados — fila horizontal de juegos featured */}
        {featured.length > 0 && (
          <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-[24px]">Destacados</h2>
              <Link
                href="/play/lobby"
                className="text-[13px] text-[var(--color-accent-text)] transition-opacity hover:opacity-80"
              >
                Ver todo →
              </Link>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-1 [scrollbar-width:thin]">
              {featured.map((g, i) => {
                const meta = CATEGORY_META[g.category] ?? CATEGORY_META.slots;
                return (
                  <div key={g.id} className="w-[150px] shrink-0">
                    <LobbyGameCard
                      title={g.name}
                      categoryLabel={meta.label}
                      players={240 + ((i * 137) % 900)}
                      hot
                      accent={meta.accent}
                      href="/play/lobby"
                    />
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Retos en línea — solo cuando no hay rail lateral (<xl) */}
        <div className="xl:hidden">
          <ChallengesRail inline />
        </div>

        {/* Todos los juegos */}
        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-[24px]">Todos los juegos</h2>
            <Link
              href="/play/lobby"
              className="text-[13px] text-[var(--color-accent-text)] transition-opacity hover:opacity-80"
            >
              Ver todo →
            </Link>
          </div>

          {games.length === 0 ? (
            <p className="text-[13px] text-[var(--color-fg-subtle)]">
              {gamesQuery.isLoading
                ? 'Cargando juegos…'
                : 'No hay juegos activos por ahora.'}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {games.map((g, i) => {
                const meta = CATEGORY_META[g.category] ?? CATEGORY_META.slots;
                return (
                  <LobbyGameCard
                    key={g.id}
                    title={g.name}
                    categoryLabel={meta.label}
                    players={120 + ((i * 173) % 820)}
                    hot={g.featured}
                    accent={meta.accent}
                    href="/play/lobby"
                  />
                );
              })}
            </div>
          )}
        </section>
      </main>

      {/* ── Columna derecha — Centro de Retos (desktop ancho) ── */}
      <aside className="hidden border-l border-[var(--color-border)] xl:block">
        <ChallengesRail />
      </aside>
    </div>
  );
}
