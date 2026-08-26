'use client';

import dynamic from 'next/dynamic';
import { useCallback, useMemo, useState } from 'react';
import { Crown, Gamepad2, Gift, Users } from 'lucide-react';
import { HomeGameCard } from '@/components/player/home-game-card';
import { StudioRows } from '@/components/player/home/studio-rows';
import { LobbyBanner } from '@/components/player/lobby/lobby-banner';
import { WinnersTicker } from '@/components/player/lobby/winners-ticker';
import type { HeroSlide } from '@/components/player/hero-carousel';
import { useAuth } from '@/lib/auth-context';
import { useActiveGames, type GameCategory } from '@/lib/hooks/use-games';
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
  slides?: Array<{ id: string; imageDesktop: string; imageMobile?: string; title: string; body: string; cta: string; href: string; accentColor: string; kicker: string; order?: number }>;
};

const CATEGORY_LABEL: Record<GameCategory, string> = {
  slots: 'Slots',
  live: 'En vivo',
  crash: 'Crash',
  table: 'Mesa',
  mini: 'Mini',
};
const CATEGORY_ORDER: GameCategory[] = ['slots', 'live', 'crash', 'table', 'mini'];

export default function PlayLobbyPage() {
  const gamesQuery = useActiveGames();
  const tenantInfo = useTenantInfo();
  const { user, openLoginModal } = useAuth();
  const isDesktop = useIsDesktop();
  const [selectedGame, setSelectedGame] = useState<string | null>(null);
  const [activeCat, setActiveCat] = useState<GameCategory | 'all'>('all');

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
      }));
  }, [designConfig, accentHex]);

  const games = gamesQuery.data?.data ?? [];
  const announcement = tenantInfo.data?.site?.announcementText;

  // Chips: solo las categorías que realmente tienen juegos (client-side, sin
  // back nuevo). Filtran la grilla "Todos los juegos" en el momento.
  const presentCats = useMemo(() => {
    const set = new Set(games.map((g) => g.category));
    return CATEGORY_ORDER.filter((c) => set.has(c));
  }, [games]);

  const filteredGames = useMemo(
    () => (activeCat === 'all' ? games : games.filter((g) => g.category === activeCat)),
    [games, activeCat],
  );

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

        {/* Catálogo principal con chips que filtran en el momento. */}
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
            <h2 className="font-display text-[19px] font-bold tracking-[-0.01em] text-[var(--color-fg)]">
              Todos los juegos
            </h2>
            <span className="font-mono text-[11px] tabular-nums text-[var(--color-fg-muted)]">
              {games.length.toLocaleString('es-AR')}
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
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
            <p className="text-[13px] text-[var(--color-fg-subtle)]">
              {gamesQuery.isLoading ? 'Cargando juegos…' : 'No hay juegos activos por ahora.'}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {filteredGames.map((game) => (
                <HomeGameCard
                  key={game.id}
                  game={game}
                  onPlay={handleGameClick}
                  isDesktop={isDesktop}
                />
              ))}
            </div>
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
        'inline-flex h-[30px] items-center rounded-full px-[13px] text-[12px] font-medium transition-colors',
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
