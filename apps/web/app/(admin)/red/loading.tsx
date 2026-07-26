'use client';

import { Skeleton } from '@/components/ui/skeleton';

export default function NetworkLoading() {
  return (
    <div className="px-4 py-4 sm:px-6 sm:py-5 lg:px-8 lg:py-6 flex flex-col gap-6 max-w-[1600px] mx-auto h-[calc(100vh-2rem)]">
      <header className="shrink-0">
        <Skeleton className="h-3 w-20 bg-[var(--color-bg-subtle)]" />
        <Skeleton className="h-8 w-40 mt-2 bg-[var(--color-bg-subtle)]" />
      </header>
      <div className="flex-1 flex rounded-xl border border-[var(--color-border)] overflow-hidden">
        <div className="w-[300px] shrink-0 border-r border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3 flex flex-col gap-2">
          <Skeleton className="h-4 w-24 bg-[var(--color-bg-subtle)]" />
          <Skeleton className="h-8 w-full bg-[var(--color-bg-subtle)]" />
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full bg-[var(--color-bg-subtle)]" style={{ marginLeft: `${(i % 4) * 12}px` }} />
          ))}
        </div>
        <div className="flex-1 flex items-center justify-center bg-[var(--color-bg)]">
          <div className="flex flex-col items-center gap-3">
            <div className="size-8 border-2 border-[var(--color-accent)] border-r-transparent animate-spin rounded-full" />
            <span className="text-[11px] text-[var(--color-fg-subtle)]">Cargando red...</span>
          </div>
        </div>
      </div>
    </div>
  );
}
