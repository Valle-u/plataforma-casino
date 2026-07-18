/**
 * Admin layout — protege rutas y monta sidebar/header.
 *
 * Guards (en orden):
 *   1. Sin sesión → /login.
 *   2. Sprint 43 (security): sesión activa PERO sin panel access (player
 *      con solo rol `usuario_final`) → /play. Defensa frontend que
 *      complementa al check del backend en /tenant/auth/login y al
 *      PanelAccessGuard en endpoints admin.
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

  // Default deny: si user existe pero canAccessPanel no es estrictamente
  // true (puede ser undefined si el endpoint /me devolvió una versión
  // vieja, o false si es player), tratar como player.
  const canAccess = user?.canAccessPanel === true;

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (!canAccess) {
      // Player que llegó al panel — redirect al sitio de juego, NO logout
      // (mantenemos su sesión válida para /play/*).
      router.replace('/play');
    }
  }, [user, loading, canAccess, router]);

  // Estado de carga / bloqueo — evitamos flash de contenido protegido.
  if (loading || !user || !canAccess) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="size-1 bg-[var(--color-accent)] animate-pulse" aria-label="Cargando" />
      </div>
    );
  }

  return (
    // Sprint 51.9: layout sticky.
    //   - <Sidebar> aside es `sticky top-0 h-screen overflow-y-auto`
    //     (clases en el componente) → fijo al scrollear.
    //   - <Header> es `sticky top-0 z-20` (en el componente) → idem en
    //     la columna main.
    //   - El root usa `flex min-h-screen` (sin `h-screen`) → el body
    //     hace el scroll → UNA scrollbar para main + una interna en el
    //     aside solo si su contenido excede viewport.
    //   - Antes <main> tenía `overflow-auto` → generaba scrollbar
    //     duplicada y peleaba con sticky. Removida.
    <div className="flex min-h-screen bg-[var(--color-bg)]">
      {/* Sprint 53.4 a11y: skip-to-content para keyboard users */}
      <a href="#admin-main" className="skip-to-content">
        Saltar al contenido
      </a>
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        <main id="admin-main" className="flex-1 px-4 py-4 sm:px-6 sm:py-5 lg:px-8 lg:py-6">{children}</main>
      </div>
    </div>
  );
}
