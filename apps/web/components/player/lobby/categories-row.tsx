'use client';

import Link from 'next/link';
import {
  Cherry,
  Radio,
  Rocket,
  CircleDot,
  Spade,
  Gift,
  Sparkles,
  Crown,
  type LucideIcon,
} from 'lucide-react';

/**
 * CategoriesRow — fila de categorías del lobby de TANGO ("Neón Milonga").
 *
 * Grid de 8 categorías. En desktop ocupa las 8 columnas (grid-cols-8);
 * en pantallas chicas hace scroll horizontal con cards de ancho fijo.
 * Cada card tiene un blob de color difuminado de fondo, un ícono en chip
 * cuadrado con glow, label y conteo. El color es propio de la categoría
 * (azul/magenta/verde/oro/violeta/cian/naranja).
 */

interface Category {
  label: string;
  count: string;
  color: string;
  href: string;
  icon: LucideIcon;
}

const CATEGORIES: Category[] = [
  { label: 'Slots', count: '1.240 juegos', color: 'var(--color-accent)', href: '/play/lobby?cat=slots', icon: Cherry },
  { label: 'En Vivo', count: '86 mesas', color: 'var(--color-magenta)', href: '/play/lobby?cat=live', icon: Radio },
  { label: 'Crash', count: '24 juegos', color: 'var(--color-success)', href: '/play/lobby?cat=crash', icon: Rocket },
  { label: 'Ruleta', count: '38 mesas', color: 'var(--color-gold)', href: '/play/lobby?cat=ruleta', icon: CircleDot },
  { label: 'Cartas', count: '52 juegos', color: 'var(--color-purple)', href: '/play/lobby?cat=cartas', icon: Spade },
  { label: 'Bonus', count: '140 juegos', color: 'var(--color-cyan)', href: '/play/lobby?cat=bonus', icon: Gift },
  { label: 'Nuevos', count: '60 juegos', color: 'var(--color-warning)', href: '/play/lobby?cat=nuevos', icon: Sparkles },
  { label: 'Jackpots', count: '18 activos', color: 'var(--color-magenta)', href: '/play/lobby?cat=jackpots', icon: Crown },
];

export function CategoriesRow() {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-display text-[24px] text-[var(--color-fg)]">
        Categorías
      </h2>

      <div className="grid grid-flow-col auto-cols-[112px] md:grid-flow-row md:auto-cols-auto md:grid-cols-8 gap-3 overflow-x-auto md:overflow-visible pb-1 [-ms-overflow-style:none] [scrollbar-width:none]">
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
      className="group relative flex flex-[0_0_auto] flex-col items-start gap-3 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-4 transition duration-[.25s] hover:-translate-y-1 hover:border-[color:var(--cat-color)]"
      style={
        {
          '--cat-color': color,
        } as React.CSSProperties
      }
    >
      {/* Blob de color difuminado de fondo */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-4 -top-4 h-20 w-20 rounded-full opacity-25 blur-2xl transition-opacity duration-[.25s] group-hover:opacity-40"
        style={{ background: color }}
      />

      {/* Glow del card en hover */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[var(--radius-lg)] opacity-0 transition-opacity duration-[.25s] group-hover:opacity-100"
        style={{ boxShadow: '0 0 22px -2px var(--cat-color)' }}
      />

      {/* Ícono en chip cuadrado con glow */}
      <span
        className="relative flex h-[42px] w-[42px] items-center justify-center rounded-[10px] border"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--cat-color) 18%, transparent)',
          borderColor: 'color-mix(in srgb, var(--cat-color) 45%, transparent)',
          boxShadow: '0 0 16px -4px var(--cat-color)',
        }}
      >
        <Icon className="h-5 w-5" style={{ color }} strokeWidth={2} />
      </span>

      <div className="relative flex flex-col gap-0.5">
        <span className="text-[14px] font-medium text-[var(--color-fg)]">
          {label}
        </span>
        <span className="text-[11px] text-[var(--color-fg-subtle)]">
          {count}
        </span>
      </div>
    </Link>
  );
}
