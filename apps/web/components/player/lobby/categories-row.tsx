'use client';

import Link from 'next/link';
import {
  Cherry,
  ChevronRight,
  Rocket,
  type LucideIcon,
} from 'lucide-react';

/**
 * CategoriesRow — fila de categorías de la home ("Neón Milonga").
 *
 * Grid de 2 categorías (las que tienen juegos hoy: slots y crash) que
 * ocupa el ancho completo en mobile y desktop (grid-cols-2, sin scroll
 * horizontal). Cada card es un tile horizontal compacto (ícono · texto ·
 * chevron) en todos los tamaños; en desktop solo crece levemente el
 * ícono y el padding para no verse gigante.
 * El color es propio de la categoría (azul/verde).
 */

interface Category {
  label: string;
  count: string;
  color: string;
  href: string;
  icon: LucideIcon;
}

const CATEGORIES: Category[] = [
  { label: 'Slots', count: '1.240 juegos', color: 'var(--color-accent)', href: '/play/lobby?category=slots', icon: Cherry },
  { label: 'Crash', count: '24 juegos', color: 'var(--color-success)', href: '/play/lobby?category=crash', icon: Rocket },
];

export function CategoriesRow() {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-display text-[24px] text-[var(--color-fg)]">
        Categorías
      </h2>

      <div className="grid grid-cols-2 gap-3 md:gap-4">
        {CATEGORIES.map((cat) => (
          <CategoryCard key={cat.label} category={cat} />
        ))}
      </div>
    </section>
  );
}

function CategoryCard({ category }: { category: Category }) {
  const { label, count, color, href, icon: Icon } = category;

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
          {count}
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
