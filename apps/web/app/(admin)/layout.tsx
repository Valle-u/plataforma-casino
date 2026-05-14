/**
 * Admin layout — protege rutas (redirige a /login si no hay sesión),
 * monta el sidebar y header.
 *
 * Layout grid:
 *   [sidebar 240px][header 56px / main 1fr]
 */

'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { Header } from '@/components/admin/header';
import { Sidebar } from '@/components/admin/sidebar';
import { useAuth } from '@/lib/auth-context';

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

  // Estado de carga inicial — evitamos flash de contenido.
  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="size-1 bg-[var(--color-accent)] animate-pulse" aria-label="Cargando" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[var(--color-bg)]">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
