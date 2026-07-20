/**
 * /play — Lobby de Casino TANGO (rediseño "Neón Milonga").
 *
 * Layout simplificado: columna única sin sidebar de eventos.
 *   - Hero: carrusel de banners con imágenes reales (/public/hero/*).
 *   - WinnersTicker: feed de ganadores recientes.
 *   - CategoriesRow: filtro rápido por categoría.
 *   - Todos los juegos: grilla con thumbnails reales, link directo al juego.
 */

'use client';

import Link from 'next/link';
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

const HERO_SLIDES: HeroSlide[] = [
  {
    id: 'welcome',
    image: 'welcome',
    href: '/play/lobby',
    icon: Crown,
    accentColor: '#ff2ea0',
    glow: 'rgba(255,46,160,0.5)',
    kicker: 'Bienvenido',
    title: 'El dueño de la noche',
    body: 'Viví la experiencia TANGO. Slots, crash, ruleta y más — todo en un solo lugar con la estética que merecés.',
    cta: 'Jugar ahora',
  },
  {
    id: 'slots',
    image: 'slots',
    href: '/play/lobby?category=slots',
    icon: Gamepad2,
    accentColor: '#00e5ff',
    glow: 'rgba(0,229,255,0.5)',
    kicker: 'Slots',
    title: 'Girás y ganás',
    body: 'Los mejores slots con jackpots progresivos. Cada giro puede ser el tuyo.',
    cta: 'Ver slots',
  },
  {
    id: 'live',
    image: 'live',
    href: '/play/lobby?category=live',
    icon: Users,
    accentColor: '#9b4dff',
    glow: 'rgba(155,77,255,0.5)',
    kicker: 'En vivo',
    title: 'Acción en tiempo real',
    body: 'Crupiés en vivo, mesas abiertas, apuestas al instante. Sentí el casino desde casa.',
    cta: 'Jugar en vivo',
  },
  {
    id: 'bonus',
    image: 'bonus',
    href: '/play/wallet',
    icon: Gift,
    accentColor: '#f0c46a',
    glow: 'rgba(240,196,106,0.5)',
    kicker: 'Bonus',
    title: 'Hasta $200.000 + 200 giros',
    body: 'Depositá y recibí bonus exclusivos. El dueño de la noche te da la bienvenida.',
    cta: 'Reclamar bonus',
  },
];

export default function PlayLobbyPage() {
  const gamesQuery = useActiveGames();

  const games = gamesQuery.data?.data ?? [];

  return (
    <div className="flex min-w-0 flex-col gap-7 px-4 py-5 sm:px-6 lg:px-8">
      {/* Hero carrusel */}
      <HeroCarousel slides={HERO_SLIDES} />

      <WinnersTicker />

      <CategoriesRow />

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
            {games.map((game) => (
              <HomeGameCard key={game.id} game={game} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
