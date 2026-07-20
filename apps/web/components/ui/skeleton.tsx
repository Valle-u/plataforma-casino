/**
 * Skeleton — placeholder con shimmer animado para loading states.
 *
 * Componentes compuestos reutilizables:
 *   - SkeletonTable: filas de tabla con columnas proporcionales.
 *   - SkeletonCard: tarjeta de contenido (titulo + lineas).
 *   - SkeletonStatGrid: grilla de KPIs/tiles.
 *
 * El gradient shimmer está definido en globals.css (`animate-shimmer`).
 */

import { type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="status"
      aria-label="Cargando…"
      className={cn('animate-shimmer rounded-[var(--radius-sm)]', className)}
      {...rest}
    />
  );
}

/**
 * SkeletonTable — placeholder de tabla con N filas y anchos proporcionales.
 * Reemplaza las LoadingTable duplicadas en 12+ páginas.
 */
export function SkeletonTable({
  rows = 6,
  columns = [0.05, 0.25, 0.15, 0.12, 0.1, 0.15, 0.18],
  className,
}: {
  rows?: number;
  /** Array de anchos proporcionales (0-1). Suma ≈ 1. */
  columns?: number[];
  className?: string;
}) {
  return (
    <div className={cn('p-4 flex flex-col gap-2', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex gap-2 h-10"
          style={{ animationDelay: `${i * 40}ms` }}
        >
          {columns.map((w, j) => (
            <Skeleton
              key={j}
              className="h-full bg-[var(--color-bg-subtle)]"
              style={{ width: `${w * 100}%`, flexShrink: 0 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * SkeletonCard — tarjeta de contenido con titulo + N lineas de texto.
 */
export function SkeletonCard({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn('p-4 flex flex-col gap-3', className)}>
      <Skeleton className="h-5 w-1/3 bg-[var(--color-bg-subtle)]" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-4 bg-[var(--color-bg-subtle)]"
          style={{ width: `${70 + Math.random() * 30}%` }}
        />
      ))}
    </div>
  );
}

/**
 * SkeletonStatGrid — grilla de tiles de estadísticas (KPIs).
 */
export function SkeletonStatGrid({
  count = 4,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={cn('grid grid-cols-2 md:grid-cols-4 gap-2', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="px-3 py-2.5 bg-[var(--color-bg-elevated)] border border-[var(--color-border)]"
        >
          <Skeleton className="h-3 w-16 bg-[var(--color-bg-subtle)] mb-2" />
          <Skeleton className="h-7 w-20 bg-[var(--color-bg-subtle)]" />
          <Skeleton className="h-3 w-24 bg-[var(--color-bg-subtle)] mt-2" />
        </div>
      ))}
    </div>
  );
}
