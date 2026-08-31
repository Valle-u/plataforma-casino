'use client';

import dynamic from 'next/dynamic';
import { useCallback, useMemo, useState } from 'react';
import { Crown, Gamepad2, Gift, Search, Users, X } from 'lucide-react';
import { HomeGameCard } from '@/components/player/home-game-card';
import { StudioRows } from '@/components/player/home/studio-rows';
import { LobbyBanner } from '@/components/player/lobby/lobby-banner';
import { WinnersTicker } from '@/components/player/lobby/winners-ticker';
import type { HeroSlide } from '@/components/player/hero-carousel';
import { useAuth } from '@/lib/auth-context';
import {
  useActiveGames,
  useGameFacets,
  type GameCategory,
} from '@/lib/hooks/use-games';
import { useDebouncedValue } from '@/lib/hooks/use-debounced-value';
import { useIsDesktop } from '@/lib/hooks/use-is-desktop';
import { useTenantInfo } from '@/lib/hooks/use-tenant-branding';
import { normalizeStorageUrl } from '@/lib/storage-url';
import { cn } from '@/lib/cn';

// Lazy load: el bundle del modal solo se descarga en desktop (igual que el
// lobby). Mobile nunca carga este chunk.
const GameModal = dynamic(
  () => import('@/components/game-modal').then((m) => m.GameModal),
  { ssr: false },
);

const FALLBACK_SLIDES: HeroSlide[] = [
  { id: 'fallback-1', image: '/hero/welcome.webp', href: '/play/lobby', icon: Crown, accentColor: '#ff2ea0', glow: 'rgba(255,46,160,0.5)', kicker: 'Bienvenido', title: 'El dueño de la noche', body: 'Viví la mejor experiencia.', cta: 'Jugar ahora' },
  { id: 'fallback-2', image: '/hero/slots.webp', href: '/play/lobby?category=slots', icon: Gamepad2, accentColor: '#00e5ff', glow: 'rgba(0,229,255,0.5)', kicker: 'Slots', title: 'Girás y ganás', body: 'Los mejores slots con jackpots.', cta: 'Ver slots' },
  { id: 'fallback-3', image: '/hero/live.webp', href: '/play/lobby?category=live', icon: Users, accentColor: '#9b4dff', glow: 'rgba(155,77,255,0.5)', kicker: 'En vivo', title: 'Acción en tiempo real', body: 'Crupiés en vivo.', cta: 'Jugar en vivo' },
  { id: 'fallback-4', image: '/hero/bonus.webp', href: '/play/account?tab=dinero', icon: Gift, accentColor: '#f0c46a', glow: 'rgba(240,196,106,0.5)', kicker: 'Bonus', title: 'Hasta $200.000 + 200 giros', body: 'Depositá y recibí bonus.', cta: 'Reclamar bonus' },
];

type DesignConfig = {
  slides?: Array<{ id: string; imageDesktop: string; imageMobile?: string; title: string; body: string; cta: string; href: string; accentColor: string; kicker: string; order?: number; align?: 'left' | 'right' }>;
};

const CATEGORY_LABEL: Record<GameCategory, string> = {
  slots: 'Slots',
  live: 'En vivo',
  crash: 'Crash',
  table: 'Mesa',
  mini: 'Mini',
};
const CATEGORY_ORDER: GameCategory[] = ['slots', 'live', 'crash', 'table', 'mini'];

/**
 * Cuántos juegos trae la home.
 *
 * Más alto que el default del backend (30) porque acá NO hay paginado: lo
 * que no entra, no existe. Con el buscador andando 60 alcanza de sobra —
 * quien busca algo puntual lo escribe, y quien mira sin rumbo no llega al
 * final de la grilla.
 */
const HOME_GAMES_LIMIT = 60;

export default function PlayLobbyPage() {
  const [search, setSearch] = useState('');
  // 300ms: no dispara una request por tecla, pero sigue sintiéndose vivo.
  const searchDebounced = useDebouncedValue(search.trim(), 300);
  const tenantInfo = useTenantInfo();
  const { user, openLoginModal } = useAuth();
  const isDesktop = useIsDesktop();
  const [selectedGame, setSelectedGame] = useState<string | null>(null);
  const [activeCat, setActiveCat] = useState<GameCategory | 'all'>('all');

  // La búsqueda y la categoría van al SERVIDOR, no se filtran en el cliente.
  // Antes se traían 30 juegos y los chips filtraban sobre esos 30: elegir una
  // categoría que no estuviera entre los primeros 30 mostraba la grilla vacía,
  // y buscar habría tenido el mismo problema sobre 2.840 juegos.
  const gamesQuery = useActiveGames({
    category: activeCat === 'all' ? undefined : activeCat,
    search: searchDebounced || undefined,
    limit: HOME_GAMES_LIMIT,
  });

  // Mismo comportamiento que el lobby: desktop → abre el modal; sin sesión →
  // modal de login; mobile → el card navega al iframe por su cuenta (Link).
  const handleGameClick = useCallback(
    (code: string) => {
      if (!user) {
        openLoginModal(`/play/games/${code}/play/iframe`);
        return;
      }
      if (isDesktop) setSelectedGame(code);
    },
    [isDesktop, user, openLoginModal],
  );

  const designConfig: DesignConfig | null = useMemo(() => {
    const raw = tenantInfo.data?.design?.slides;
    if (!raw || typeof raw !== 'object') return null;
    return { slides: raw as DesignConfig['slides'] };
  }, [tenantInfo.data]);

  const accentHex = useMemo(() => {
    const c = (tenantInfo.data?.design?.colors as { accentColor?: string } | undefined)?.accentColor;
    return c || tenantInfo.data?.branding?.primaryColor || '#ff2ea0';
  }, [tenantInfo.data?.design?.colors, tenantInfo.data?.branding?.primaryColor]);

  const slides: HeroSlide[] = useMemo(() => {
    if (!designConfig?.slides || designConfig.slides.length === 0) {
      return FALLBACK_SLIDES.map((s) => ({
        ...s,
        accentColor: accentHex,
        glow: hexToRgba(accentHex, 0.5),
      }));
    }
    return designConfig.slides
      .filter((s) => s.imageDesktop)
      .map((s, i) => ({
        id: s.id || `slide-${i}`,
        image: normalizeStorageUrl(s.imageDesktop),
        imageMobile: normalizeStorageUrl(s.imageMobile || s.imageDesktop),
        href: s.href || '/play/lobby',
        icon: Crown,
        accentColor: s.accentColor || accentHex,
        glow: hexToRgba(s.accentColor || accentHex, 0.5),
        kicker: s.kicker || 'Slide',
        title: s.title || 'Sin título',
        body: s.body || '',
        cta: s.cta || 'Ver más',
        // Solo 'right' cambia algo; cualquier otro valor (o ausencia, que es
        // el caso de los slides guardados antes de este campo) cae en 'left'.
        align: s.align === 'right' ? 'right' : 'left',
      }));
  }, [designConfig, accentHex]);

  const games = gamesQuery.data?.data ?? [];
  const announcement = tenantInfo.data?.site?.announcementText;

  // Las categorías salen de las FACETAS (conteos globales), no de los juegos
  // que se están mostrando. Si salieran de la grilla, al elegir "Mesa" los
  // juegos traídos serían todos de mesa y los demás chips desaparecerían —
  // el jugador quedaría encerrado en la categoría que eligió.
  const facets = useGameFacets();
  const presentCats = useMemo(() => {
    const conCategoria = new Set(
      (facets.data?.categories ?? [])
        .filter((c) => c.count > 0)
        .map((c) => c.category),
    );
    return CATEGORY_ORDER.filter((c) => conCategoria.has(c));
  }, [facets.data]);

  const total = gamesQuery.data?.total ?? 0;
  const buscando = searchDebounced !== "";

  return (
    <div className="flex flex-col -mt-14 lg:-mt-16">
      {/* Banner a sangre (arranca detrás del header translúcido en desktop). */}
      <LobbyBanner slides={slides} />

      {/* Franja "Ganando ahora" — el borde duro del banner. */}
      <WinnersTicker variant="bar" />

      <div className="flex flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8">
        {announcement && (
          <div
            className="flex items-center justify-center gap-2 rounded-[var(--radius)] border border-[var(--color-accent-border)] bg-[var(--color-accent-subtle)] px-4 py-2.5 text-[13px] text-[var(--color-fg)]"
            role="status"
          >
            {announcement}
          </div>
        )}

        {/*
          Catálogo principal: buscador + categorías, los dos server-side.

          El buscador vive acá y no solo en el lobby porque muchos jugadores no
          navegan entre secciones: si el juego que buscan no está en la grilla
          de la home, para ellos no existe. Por eso es grande y con la etiqueta
          escrita — un ícono de lupa solo no se lee como "acá se busca".
        */}
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="font-display text-[19px] font-bold tracking-[-0.01em] text-[var(--color-fg)]">
                Todos los juegos
              </h2>
              <span className="font-mono text-[11px] tabular-nums text-[var(--color-fg-muted)]">
                {total.toLocaleString('es-AR')}
              </span>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-[var(--color-fg-muted)]">
                Buscar un juego
              </span>
              <span className="relative block">
                <Search
                  aria-hidden
                  className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[var(--color-fg-subtle)]"
                />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Escribí el nombre del juego"
                  autoComplete="off"
                  // h-14 y 16px de texto: objetivo grande y sin zoom en iOS
                  // (Safari hace zoom cuando el input mide menos de 16px).
                  className="h-14 w-full rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] pl-12 pr-12 text-[16px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-glow)]"
                />
                {search !== '' && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    aria-label="Borrar la búsqueda"
                    className="absolute right-2 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full text-[var(--color-fg-muted)] transition-colors hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]"
                  >
                    <X className="size-5" />
                  </button>
                )}
              </span>
            </label>

            <div className="-mx-4 flex snap-x items-center gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 [-ms-overflow-style:none] [scrollbar-width:thin]">
              <CategoryChip
                label="Todos"
                active={activeCat === 'all'}
                onClick={() => setActiveCat('all')}
              />
              {presentCats.map((c) => (
                <CategoryChip
                  key={c}
                  label={CATEGORY_LABEL[c]}
                  active={activeCat === c}
                  onClick={() => setActiveCat(c)}
                />
              ))}
            </div>
          </div>

          {games.length === 0 ? (
            <p className="text-[14px] text-[var(--color-fg-muted)]">
              {gamesQuery.isLoading
                ? 'Buscando…'
                : buscando
                  ? `No encontramos ningún juego que se llame “${searchDebounced}”. Probá con otra palabra.`
                  : 'No hay juegos activos por ahora.'}
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {games.map((game) => (
                  <HomeGameCard
                    key={game.id}
                    game={game}
                    onPlay={handleGameClick}
                    isDesktop={isDesktop}
                  />
                ))}
              </div>
              {total > games.length && (
                <p className="text-[13px] text-[var(--color-fg-muted)]">
                  Mostrando {games.length} de {total.toLocaleString('es-AR')}.{' '}
                  {buscando
                    ? 'Si no ves el que buscás, escribí un poco más.'
                    : 'Buscá por nombre para encontrar uno puntual.'}
                </p>
              )}
            </>
          )}
        </section>

        {/* Filas por estudio (Pragmatic, BGaming, …) — se auto-ocultan si no hay. */}
        <StudioRows onPlay={handleGameClick} isDesktop={isDesktop} />
      </div>

      {/* Desktop: el mismo modal de juego que el lobby. */}
      {isDesktop && (
        <GameModal
          gameCode={selectedGame ?? ''}
          open={!!selectedGame}
          onOpenChange={(open) => {
            if (!open) setSelectedGame(null);
          }}
        />
      )}
    </div>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        // h-11 (44px) es el mínimo táctil recomendado. Antes eran 30px: para
        // un jugador mayor, o con el pulgar en el celular, ese chip se erra.
        'inline-flex h-11 shrink-0 snap-start items-center rounded-full px-4 text-[14px] font-medium whitespace-nowrap transition-colors',
        active
          ? 'text-[var(--color-accent-fg)]'
          : 'border border-[color:color-mix(in_srgb,var(--color-accent)_22%,transparent)] bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]',
      )}
      style={active ? { background: 'var(--color-accent)' } : undefined}
    >
      {label}
    </button>
  );
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return `rgba(255,46,160,${alpha})`;
  return `rgba(${r},${g},${b},${alpha})`;
}
