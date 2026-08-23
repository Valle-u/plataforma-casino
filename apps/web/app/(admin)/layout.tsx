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
import { AdminLoadingSkeleton } from '@/components/admin/admin-loading-skeleton';
import { Header } from '@/components/admin/header';
import { RouteProgress } from '@/components/admin/route-progress';
import { Sidebar } from '@/components/admin/sidebar';
import { adminAccentVars } from '@/lib/admin-accent';
import {
  cacheAdminAppearance,
  deriveAdminVars,
  injectAdminVars,
  readCachedAdminAppearance,
} from '@/lib/admin-appearance';
import { cn } from '@/lib/cn';
import { useAuth } from '@/lib/auth-context';
import { useTenantInfo } from '@/lib/hooks/use-tenant-branding';
import { applyPanelFavicon } from '@/lib/tenant-favicon';

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, loading } = useAuth();
  const tenantInfo = useTenantInfo();
  const isImpersonating = !!user?.impersonatedBy;

  // Favicon FIJO del panel: la marca del producto (Retícula), NO el favicon
  // del tenant. La pestaña del panel se distingue siempre de la del casino y
  // no cambia por tenant/socio (a diferencia del player, que sí lo personaliza).
  useEffect(() => {
    if (typeof document === 'undefined') return;
    applyPanelFavicon();
  }, []);

  // Default deny: si user existe pero canAccessPanel no es estrictamente
  // true (puede ser undefined si el endpoint /me devolvió una versión
  // vieja, o false si es player), tratar como player.
  const canAccess = user?.canAccessPanel === true;

  // Tema monocromático para los PORTALES. `.admin-neutral` está en el
  // contenedor del panel, pero los modales/menús/drawers se renderizan en
  // portales colgados de <body> (fuera de ese contenedor) → heredaban el rosa
  // del :root. Aplicamos la clase también al <body> mientras el panel está
  // montado; se saca al desmontar (el sitio del jugador /play sigue rosa).
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.add('admin-neutral');
    // Anti-flash: si el operador ya configuró la apariencia del panel, la
    // pintamos desde el cache local antes de que llegue /tenant/info.
    const cached = readCachedAdminAppearance();
    if (cached) injectAdminVars(deriveAdminVars(cached));
    return () => {
      document.body.classList.remove('admin-neutral');
      injectAdminVars(null);
    };
  }, []);

  // Apariencia del panel: si el operador configuró `admin.appearance`, deriva
  // la paleta completa (fondo + acento + texto + bordes) e inyecta una regla
  // `.admin-neutral{…}` que gana sobre los defaults de globals.css y llega a
  // los modales portaleados al <body>. Si NO configuró nada, caemos al
  // comportamiento previo: solo el acento, tomado del color de marca. Los
  // colores semánticos quedan fijos (un color = una acción). Cacheamos para
  // pintar sin flash en el próximo arranque.
  const primaryColor = tenantInfo.data?.branding?.primaryColor ?? null;
  const adminAppearance = tenantInfo.data?.adminAppearance ?? null;
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (adminAppearance) {
      injectAdminVars(deriveAdminVars(adminAppearance));
      cacheAdminAppearance(adminAppearance);
    } else {
      injectAdminVars(primaryColor ? adminAccentVars(primaryColor) : null);
      cacheAdminAppearance(null);
    }
  }, [adminAppearance, primaryColor]);

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

  // Estado de carga / bloqueo — skeleton que imita la estructura real.
  // Wrap con admin-neutral para que el skeleton sea monocromático desde el
  // primer frame (sin flash violeta del tema base).
  if (loading || !user || !canAccess) {
    return (
      <div className="admin-neutral min-h-screen bg-[var(--color-bg)]">
        <AdminLoadingSkeleton />
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
    <div className={cn('admin-neutral flex min-h-screen bg-[var(--color-bg)]', isImpersonating && 'pt-8')}>
      <RouteProgress />
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
