'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

/**
 * RequireAuth — client-side auth guard for protected /play/* pages.
 *
 * When user is not logged in, redirects to /play/login?next=<currentPath>.
 * While loading, shows a minimal spinner to avoid flash.
 *
 * Usage: wrap any protected page component:
 *   export default function Page() { return <RequireAuth><ActualPage /></RequireAuth> }
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      const current = window.location.pathname + window.location.search;
      router.replace(`/play/login?next=${encodeURIComponent(current)}`);
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="size-1 bg-[var(--color-accent)] animate-pulse" />
      </div>
    );
  }

  if (!user) return null;

  return <>{children}</>;
}
