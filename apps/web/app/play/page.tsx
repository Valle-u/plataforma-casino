'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import {
  Crown,
  Gamepad2,
  Gift,
  Users,
} from 'lucide-react';
import { CategoriesRow } from '@/components/player/lobby/categories-row';
import { HeroCarousel, type HeroSlide } from '@/components/player/hero-carousel';
import { HomeGameCard } from '@/components/player/home-game-card';
import { WinnersTicker } from '@/components/player/lobby/winners-ticker';
import { useActiveGames } from '@/lib/hooks/use-games';
import { useTenantInfo } from '@/lib/hooks/use-tenant-branding';

const FALLBACK_SLIDES: HeroSlide[] = [
  { id: 'fallback-1', image: '/hero/welcome.webp', href: '/play/lobby', icon: Crown, accentColor: '#ff2ea0', glow: 'rgba(255,46,160,0.5)', kicker: 'Bienvenido', title: 'El dueño de la noche', body: 'Viví la experiencia TANGO.', cta: 'Jugar ahora' },
  { id: 'fallback-2', image: '/hero/slots.webp', href: '/play/lobby?category=slots', icon: Gamepad2, accentColor: '#00e5ff', glow: 'rgba(0,229,255,0.5)', kicker: 'Slots', title: 'Girás y ganás', body: 'Los mejores slots con jackpots.', cta: 'Ver slots' },
  { id: 'fallback-3', image: '/hero/live.webp', href: '/play/lobby?category=live', icon: Users, accentColor: '#9b4dff', glow: 'rgba(155,77,255,0.5)', kicker: 'En vivo', title: 'Acción en tiempo real', body: 'Crupiés en vivo.', cta: 'Jugar en vivo' },
  { id: 'fallback-4', image: '/hero/bonus.webp', href: '/play/wallet', icon: Gift, accentColor: '#f0c46a', glow: 'rgba(240,196,106,0.5)', kicker: 'Bonus', title: 'Hasta $200.000 + 200 giros', body: 'Depositá y recibí bonus.', cta: 'Reclamar bonus' },
];

type DesignConfig = {
  slides?: Array<{ id: string; imageDesktop: string; imageMobile?: string; title: string; body: string; cta: string; href: string; accentColor: string; kicker: string; order?: number }>;
  colors?: { bgColor?: string; textColor?: string; accentColor?: string };
  texts?: { heroTitle?: string; heroSubtitle?: string; tilesTitle?: string; tilesSubtitle?: string };
  brand?: { platformName?: string; logoUrl?: string; faviconUrl?: string };
};

export default function PlayLobbyPage() {
  const gamesQuery = useActiveGames();
  const tenantInfo = useTenantInfo();

  const designConfig: DesignConfig | null = useMemo(() => {
    const raw = tenantInfo.data?.design?.slides;
    if (!raw || typeof raw !== 'object') return null;
    return { slides: raw as DesignConfig['slides'] };
  }, [tenantInfo.data]);

  const slides: HeroSlide[] = useMemo(() => {
    if (!designConfig?.slides || designConfig.slides.length === 0) return FALLBACK_SLIDES;
    return designConfig.slides
      .filter((s) => s.imageDesktop)
      .map((s, i) => ({
        id: s.id || `slide-${i}`,
        image: s.imageDesktop,
        imageMobile: s.imageMobile || s.imageDesktop,
        href: s.href || '/play/lobby',
        icon: Crown,
        accentColor: s.accentColor || '#ff2ea0',
        glow: hexToRgba(s.accentColor || '#ff2ea0', 0.5),
        kicker: s.kicker || 'Slide',
        title: s.title || 'Sin título',
        body: s.body || '',
        cta: s.cta || 'Ver más',
      }));
  }, [designConfig]);

  const games = gamesQuery.data?.data ?? [];

  return (
    <div className="flex min-w-0 flex-col gap-7 px-4 py-5 sm:px-6 lg:px-8">
      <HeroCarousel slides={slides} />
      <WinnersTicker />
      <CategoriesRow />

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
            {gamesQuery.isLoading ? 'Cargando juegos…' : 'No hay juegos activos por ahora.'}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {games.map((game) => (
              <HomeGameCard key={game.id} game={game} />
            ))}
          </div>
        )}
      </section>
    </div>
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
