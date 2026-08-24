'use client';

import Link from 'next/link';
import {
  Cherry,
  ChevronRight,
  Dices,
  Radio,
  Rocket,
  Spade,
  type LucideIcon,
} from 'lucide-react';
import { useGameFacets, type GameCategory } from '@/lib/hooks/use-games';

/**
 * CategoriesRow — fila de categorías de la home.
 *
 * Se arma DINÁMICAMENTE desde `/tenant/games/facets`: solo aparecen las
 * categorías que realmente tienen juegos, con el **conteo real** (antes eran
 * 2 tiles hardcodeadas con números inventados). Cada card es un tile horizontal
 * compacto (ícono · texto · chevron), con color propio de la categoría.
 */

interface CategoryMeta {
  label: string;
  color: string;
  icon: LucideIcon;
}

// Metadata visual de las 5 categorías que soporta el backend. El orden define
// cómo se muestran; solo se renderizan las que tienen juegos.
const CATEGORY_META: Record<GameCategory, CategoryMeta> = {
  slots: { label: 'Slots', color: 'var(--color-accent)', icon: Cherry },
  live: { label: 'En Vivo', color: '#e0567b', icon: Radio },
  crash: { label: 'Crash', color: 'var(--color-success)', icon: Rocket },
  table: { label: 'Mesa', color: '#5b8def', icon: Spade },
  mini: { label: 'Mini', color: '#f0a020', icon: Dices },
};

const CATEGORY_ORDER: GameCategory[] = [
  'slots',
  'live',
  'crash',
  'table',
  'mini',
];

function formatCount(n: number): string {
  return `${n.toLocaleString('es-AR')} juego${n === 1 ? '' : 's'}`;
}

export function CategoriesRow() {
  const { data: facets, isLoading } = useGameFacets();

  // Mapa category → count real (solo > 0).
  const counts = new Map<GameCategory, number>();
  for (const c of facets?.categories ?? []) {
    if (c.count > 0) counts.set(c.category, c.count);
  }
  const cats = CATEGORY_ORDER.filter((c) => counts.has(c));

  // Sin datos aún: skeletons para no saltar el layout. Sin categorías: nada.
  if (isLoading) {
    return (
      <section className="flex flex-col gap-4">
        <h2 className="font-display text-[24px] text-[var(--color-fg)]">
          Categorías
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-[62px] animate-pulse rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)]"
            />
          ))}
        </div>
      </section>
    );
  }

  if (cats.length === 0) return null;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-display text-[24px] text-[var(--color-fg)]">
        Categorías
      </h2>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
        {cats.map((cat) => (
          <CategoryCard
            key={cat}
            meta={CATEGORY_META[cat]}
            count={counts.get(cat)!}
            href={`/play/lobby?category=${cat}`}
          />
        ))}
      </div>
    </section>
  );
}

function CategoryCard({
  meta,
  count,
  href,
}: {
  meta: CategoryMeta;
  count: number;
  href: string;
}) {
  const { label, color, icon: Icon } = meta;

  return (
    <Link
      href={href}
      className="group relative flex min-w-0 items-center gap-3 md:gap-4 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3 md:p-4 transition duration-[.25s] hover:-translate-y-1 hover:border-[color:var(--cat-color)]"
      style={
        {
          '--cat-color': color,
        } as React.CSSProperties
      }
    >
      {/* Blob de color difuminado de fondo */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-4 -top-4 h-16 w-16 rounded-full opacity-25 blur-2xl transition-opacity duration-[.25s] group-hover:opacity-40"
        style={{ background: color }}
      />

      {/* Glow del card en hover */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[var(--radius-lg)] opacity-0 transition-opacity duration-[.25s] group-hover:opacity-100"
        style={{ boxShadow: '0 0 22px -2px var(--cat-color)' }}
      />

      {/* Ícono */}
      <span
        className="relative grid size-9 md:size-10 shrink-0 place-items-center rounded-[8px] border"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--cat-color) 18%, transparent)',
          borderColor: 'color-mix(in srgb, var(--cat-color) 45%, transparent)',
          boxShadow: '0 0 16px -4px var(--cat-color)',
        }}
      >
        <Icon className="size-4 md:size-[18px]" style={{ color }} strokeWidth={2} />
      </span>

      {/* Texto */}
      <div className="relative flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13px] md:text-[15px] font-medium text-[var(--color-fg)]">
          {label}
        </span>
        <span className="text-[10px] md:text-[11px] text-[var(--color-fg-subtle)]">
          {formatCount(count)}
        </span>
      </div>

      {/* Chevron a la derecha */}
      <span
        aria-hidden
        className="relative ml-auto text-[var(--color-fg-subtle)] transition-all duration-[.25s] group-hover:translate-x-0.5 group-hover:text-[color:var(--cat-color)]"
      >
        <ChevronRight className="size-4 md:size-5" />
      </span>
    </Link>
  );
}
