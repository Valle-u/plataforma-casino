'use client';

import { useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';

/**
 * RequireAuth — client-side auth guard for protected /play/* pages.
 *
 * When user is not logged in, opens the login modal.
 * While loading, shows a minimal spinner to avoid flash.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading, openLoginModal } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      const current = window.location.pathname;
      openLoginModal(current);
    }
  }, [user, loading, openLoginModal]);

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
