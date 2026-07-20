/**
 * AdminLoadingSkeleton — splash de carga que se muestra mientras se valida
 * la sesión (auth bootstrap). Imita la estructura real del admin layout
 * (sidebar 240px + header 56px + contenido) para que la transición sea
 * imperceptible.
 *
 * Se muestra en el admin layout cuando loading=true o user=null.
 */

import { Skeleton } from '@/components/ui/skeleton';

export function AdminLoadingSkeleton() {
  return (
    <div className="flex min-h-screen bg-[var(--color-bg)]" aria-busy="true" aria-label="Cargando panel…">
      {/* ── Sidebar skeleton (hidden below lg) ──────────────── */}
      <aside className="hidden lg:flex flex-col w-60 shrink-0 border-r border-[var(--color-border)]">
        {/* Brand */}
        <div className="flex items-center gap-3 px-4 h-14 shrink-0 border-b border-[var(--color-border)]">
          <Skeleton className="h-5 w-24 bg-[var(--color-bg-subtle)]" />
          <Skeleton className="h-3 w-16 bg-[var(--color-bg-subtle)]" />
        </div>

        {/* Nav sections */}
        <nav className="flex-1 min-h-0 overflow-y-hidden py-3 px-2 flex flex-col gap-2">
          {/* Section 1 */}
          <Skeleton className="h-4 w-20 bg-[var(--color-bg-subtle)] mx-2" />
          <div className="flex flex-col gap-0.5 mt-0.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2.5 px-2.5 py-1.5 border-l-2 border-l-transparent">
                <Skeleton className="size-3.5 bg-[var(--color-bg-subtle)]" />
                <Skeleton className="h-3.5 bg-[var(--color-bg-subtle)]" style={{ width: `${60 + (i % 3) * 15}%` }} />
              </div>
            ))}
          </div>

          {/* Section 2 */}
          <Skeleton className="h-4 w-28 bg-[var(--color-bg-subtle)] mx-2 mt-1" />
          <div className="flex flex-col gap-0.5 mt-0.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2.5 px-2.5 py-1.5 border-l-2 border-l-transparent">
                <Skeleton className="size-3.5 bg-[var(--color-bg-subtle)]" />
                <Skeleton className="h-3.5 bg-[var(--color-bg-subtle)]" style={{ width: `${55 + (i % 3) * 18}%` }} />
              </div>
            ))}
          </div>

          {/* Section 3 */}
          <Skeleton className="h-4 w-32 bg-[var(--color-bg-subtle)] mx-2 mt-1" />
          <div className="flex flex-col gap-0.5 mt-0.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2.5 px-2.5 py-1.5 border-l-2 border-l-transparent">
                <Skeleton className="size-3.5 bg-[var(--color-bg-subtle)]" />
                <Skeleton className="h-3.5 bg-[var(--color-bg-subtle)]" style={{ width: `${50 + (i % 3) * 20}%` }} />
              </div>
            ))}
          </div>
        </nav>

        {/* Balance chip */}
        <div className="border-t border-[var(--color-border)] px-3 py-2.5 shrink-0">
          <div className="flex items-center gap-2.5">
            <Skeleton className="size-3.5 bg-[var(--color-bg-subtle)]" />
            <div className="flex flex-col gap-1">
              <Skeleton className="h-2.5 w-12 bg-[var(--color-bg-subtle)]" />
              <Skeleton className="h-3.5 w-16 bg-[var(--color-bg-subtle)]" />
            </div>
          </div>
        </div>

        {/* User chip */}
        <div className="border-t border-[var(--color-border)] p-3 shrink-0">
          <div className="flex items-center gap-2">
            <Skeleton className="size-7 bg-[var(--color-bg-subtle)]" />
            <div className="flex-1 min-w-0 flex flex-col gap-1">
              <Skeleton className="h-3 w-20 bg-[var(--color-bg-subtle)]" />
              <Skeleton className="h-2.5 w-16 bg-[var(--color-bg-subtle)]" />
            </div>
            <Skeleton className="size-7 bg-[var(--color-bg-subtle)]" />
          </div>
        </div>
      </aside>

      {/* ── Main area skeleton ─────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-14 shrink-0 border-b border-[var(--color-border)] flex items-center gap-3 sm:gap-4 px-4 sm:px-6">
          <Skeleton className="h-4 w-32 bg-[var(--color-bg-subtle)]" />
          <div className="flex-1" />
          <Skeleton className="hidden md:block h-7 w-36 bg-[var(--color-bg-subtle)]" />
          <Skeleton className="size-10 bg-[var(--color-bg-subtle)]" />
          <Skeleton className="size-10 bg-[var(--color-bg-subtle)]" />
        </header>

        {/* Content */}
        <main className="flex-1 px-4 py-4 sm:px-6 sm:py-5 lg:px-8 lg:py-6 flex flex-col gap-6">
          {/* Page header skeleton */}
          <div className="flex flex-col gap-2 pb-2">
            <Skeleton className="h-3 w-32 bg-[var(--color-bg-subtle)]" />
            <Skeleton className="h-8 w-64 bg-[var(--color-bg-subtle)]" />
            <Skeleton className="h-4 w-80 bg-[var(--color-bg-subtle)]" />
          </div>

          {/* Stats row skeleton */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-[var(--color-border)]">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-[var(--color-bg-elevated)] p-4 flex flex-col gap-2">
                <Skeleton className="h-3 w-20 bg-[var(--color-bg-subtle)]" />
                <Skeleton className="h-7 w-16 bg-[var(--color-bg-subtle)]" />
                <Skeleton className="h-3 w-24 bg-[var(--color-bg-subtle)]" />
              </div>
            ))}
          </div>

          {/* Table skeleton */}
          <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] p-4 flex flex-col gap-2">
            <Skeleton className="h-4 w-40 bg-[var(--color-bg-subtle)] mb-2" />
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex gap-2 h-10" style={{ animationDelay: `${i * 40}ms` }}>
                <Skeleton className="h-full bg-[var(--color-bg-subtle)]" style={{ width: '8%' }} />
                <Skeleton className="h-full bg-[var(--color-bg-subtle)]" style={{ width: '25%' }} />
                <Skeleton className="h-full bg-[var(--color-bg-subtle)]" style={{ width: '15%' }} />
                <Skeleton className="h-full bg-[var(--color-bg-subtle)]" style={{ width: '12%' }} />
                <Skeleton className="h-full bg-[var(--color-bg-subtle)]" style={{ width: '10%' }} />
                <Skeleton className="h-full bg-[var(--color-bg-subtle)]" style={{ width: '15%' }} />
                <Skeleton className="h-full bg-[var(--color-bg-subtle)]" style={{ width: '15%' }} />
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
