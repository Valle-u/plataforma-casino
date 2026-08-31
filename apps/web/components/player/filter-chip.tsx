/**
 * FilterChip — el chip de filtro del jugador, compartido por la home
 * (`/play`), el lobby (`/play/lobby`) y el filtro por estudio.
 *
 * Existía tres veces con tres tamaños distintos (30px, 36px y 44px de alto) y
 * tres tamaños de texto. Al pasar de una sección a otra los mismos controles
 * cambiaban de forma, y la página se sentía armada por partes.
 *
 * **44px de alto** es el mínimo táctil recomendado. Antes el de la home medía
 * 30: con el pulgar sobre un celular, y más si el jugador es una persona mayor,
 * ese chip se erra.
 */

'use client';

import { cn } from '@/lib/cn';

export function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  /** Cuántos juegos caen en este filtro. Se omite cuando no aporta. */
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex h-11 shrink-0 snap-start items-center gap-2 rounded-full px-4 text-[14px] font-medium whitespace-nowrap transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]',
        active
          ? 'text-[var(--color-accent-fg)]'
          : 'border border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] hover:border-[var(--color-accent-border)] hover:text-[var(--color-fg)]',
      )}
      style={active ? { background: 'var(--color-accent)' } : undefined}
    >
      {label}
      {count !== undefined && (
        <span
          className={cn(
            'text-[12px] tabular-nums',
            active ? 'opacity-80' : 'text-[var(--color-fg-subtle)]',
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}
