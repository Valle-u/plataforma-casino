'use client';

import { Skeleton } from '@/components/ui/skeleton';

export default function NetworkLoading() {
  return (
    <div className="px-4 py-4 sm:px-6 sm:py-5 lg:px-8 lg:py-6 flex flex-col gap-5 max-w-[1600px] mx-auto min-h-screen">
      <header className="shrink-0">
        <Skeleton className="h-3 w-20 bg-[var(--color-bg-subtle)]" />
        <div className="flex items-center gap-3 mt-2">
          <Skeleton className="h-8 w-32 bg-[var(--color-bg-subtle)]" />
          <Skeleton className="h-5 w-16 rounded-full bg-[var(--color-bg-subtle)]" />
          <Skeleton className="h-5 w-16 rounded-full bg-[var(--color-bg-subtle)]" />
        </div>
      </header>

      <div className="shrink-0 flex items-center gap-3">
        <Skeleton className="h-9 w-64 bg-[var(--color-bg-subtle)]" />
        <Skeleton className="h-9 w-36 bg-[var(--color-bg-subtle)]" />
        <Skeleton className="h-9 w-20 bg-[var(--color-bg-subtle)]" />
        <Skeleton className="h-9 w-20 bg-[var(--color-bg-subtle)]" />
      </div>

      <div className="flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-8">
        <div className="flex flex-col items-center gap-6">
          {/* Root node */}
          <Skeleton className="h-14 w-56 rounded-xl bg-[var(--color-bg-subtle)]" />
          <Skeleton className="w-px h-5 bg-[var(--color-bg-subtle)]" />

          {/* Level 2 */}
          <div className="flex gap-8">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="flex flex-col items-center gap-4">
                <Skeleton className="h-14 w-52 rounded-xl bg-[var(--color-bg-subtle)]" />
                <Skeleton className="w-px h-5 bg-[var(--color-bg-subtle)]" />
                <div className="flex gap-4">
                  {Array.from({ length: 3 }).map((_, j) => (
                    <Skeleton key={j} className="h-14 w-44 rounded-xl bg-[var(--color-bg-subtle)]" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
