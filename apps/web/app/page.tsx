/**
 * Root route — redirige según el panel (subdominio):
 *   - admin.xxx → /dashboard (o /login si no hay sesión)
 *   - player    → /play
 *
 * La decisión la hacemos en cliente porque el token vive en localStorage.
 */

'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { getPanel } from '@/lib/api-client';

export default function RootPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (getPanel() === 'admin') {
      router.replace(user ? '/dashboard' : '/login');
    } else {
      router.replace('/play');
    }
  }, [user, loading, router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="size-1 bg-[var(--color-accent)] animate-pulse" aria-label="Cargando" />
    </div>
  );
}
