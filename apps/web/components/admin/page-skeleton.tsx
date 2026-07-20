/**
 * PageSkeleton — esqueleto genérico para loading.tsx de páginas admin.
 *
 * Muestra header + stats + tabla placeholder, todo con shimmer.
 * Se usa como Suspense boundary en las rutas del admin.
 */

import { Skeleton } from '@/components/ui/skeleton';

export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-6 animate-fade-up" aria-busy="true" aria-label="Cargando página…">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-2">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-32 bg-[var(--color-bg-subtle)]" />
          <Skeleton className="h-8 w-64 bg-[var(--color-bg-subtle)]" />
          <Skeleton className="h-4 w-80 bg-[var(--color-bg-subtle)]" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28 bg-[var(--color-bg-subtle)]" />
          <Skeleton className="h-9 w-32 bg-[var(--color-bg-subtle)]" />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="px-3 py-2.5 bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
            <Skeleton className="h-3 w-16 bg-[var(--color-bg-subtle)]" />
            <Skeleton className="h-7 w-20 bg-[var(--color-bg-subtle)] mt-1" />
            <Skeleton className="h-3 w-24 bg-[var(--color-bg-subtle)] mt-1" />
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
        <Skeleton className="h-9 w-64 bg-[var(--color-bg-subtle)]" />
        <div className="flex gap-px bg-[var(--color-border)]">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 bg-[var(--color-bg-subtle)]" style={{ width: `${60 + (i % 2) * 20}px` }} />
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto">
        <div className="p-4 flex flex-col gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex gap-2 h-10" style={{ animationDelay: `${i * 40}ms` }}>
              <Skeleton className="h-full bg-[var(--color-bg-subtle)]" style={{ width: '6%' }} />
              <Skeleton className="h-full bg-[var(--color-bg-subtle)]" style={{ width: '22%' }} />
              <Skeleton className="h-full bg-[var(--color-bg-subtle)]" style={{ width: '14%' }} />
              <Skeleton className="h-full bg-[var(--color-bg-subtle)]" style={{ width: '10%' }} />
              <Skeleton className="h-full bg-[var(--color-bg-subtle)]" style={{ width: '12%' }} />
              <Skeleton className="h-full bg-[var(--color-bg-subtle)]" style={{ width: '16%' }} />
              <Skeleton className="h-full bg-[var(--color-bg-subtle)]" style={{ width: '20%' }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
