/**
 * Root route — redirige a /dashboard si hay sesión, sino a /login.
 * La decisión la hacemos en cliente porque el token vive en localStorage.
 */

'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';

export default function RootPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? '/dashboard' : '/login');
  }, [user, loading, router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="size-1 bg-[var(--color-accent)] animate-pulse" aria-label="Cargando" />
    </div>
  );
}
