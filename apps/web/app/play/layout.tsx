/**
 * Player layout — protege rutas (redirige a /play/login si no hay sesión)
 * y monta el header del jugador.
 *
 * Diferencias con admin:
 *   - Sin sidebar — nav horizontal en el header (mobile-first).
 *   - Vibe consumer (rojo del DS + dorado sutil para "premium"), NO terminal.
 *   - Layout más aireado, content max-width 1100px.
 *   - Footer simple con links útiles + tenant info.
 *
 * Sesión: comparte el mismo `AuthProvider` que el admin (root layout).
 * Un user con perms de admin puede entrar a /play y navegar — la
 * separación es UX, no de identidad. La idea es que un admin pueda
 * "ver lo que ve el jugador" para soporte.
 */

'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, type CSSProperties, type ReactNode } from 'react';
import { FloatingLeagueWidget } from '@/components/player/floating-league-widget';
import { PlatformBackground } from '@/components/player/platform-background';
import { PlayerBottomNav } from '@/components/player/player-bottom-nav';
import { PlayerHeader } from '@/components/player/player-header';
import { WinToastWatcher } from '@/components/player/win-toast-watcher';
import { useAuth } from '@/lib/auth-context';
import { useTenantInfo } from '@/lib/hooks/use-tenant-branding';

export default function PlayerLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading } = useAuth();

  // Sprint 29: branding del tenant. Aplicamos override de `--color-accent`
  // via inline style en el wrapper (scoped a /play, no contamina /admin).
  // Si el setting no existe o el endpoint falla, no aplicamos override
  // y el DS usa el accent default.
  const tenantInfo = useTenantInfo();
  const branding = tenantInfo.data?.branding;

  const brandingStyle = useMemo<CSSProperties | undefined>(() => {
    if (!branding?.primaryColor) return undefined;
    return { ['--color-accent' as string]: branding.primaryColor };
  }, [branding?.primaryColor]);

  // Favicon dinámico: si el tenant tiene logo, lo usamos como icono del
  // tab del browser. Sin librerías — manipulamos el <link> directo en
  // document.head. Idempotente: si ya existe un <link rel="icon"> con
  // un valor anterior, lo pisamos. Cleanup en unmount → restore al default.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!branding?.logoUrl) return;
    const head = document.head;
    const existing = head.querySelector<HTMLLinkElement>(
      'link[rel="icon"][data-tenant-branding]',
    );
    const link = existing ?? document.createElement('link');
    link.rel = 'icon';
    link.setAttribute('data-tenant-branding', '1');
    link.href = branding.logoUrl;
    if (!existing) head.appendChild(link);
    return () => {
      link.remove();
    };
  }, [branding?.logoUrl]);

  // El login page tiene su propia UI fullscreen y NO debe redirigir si no
  // hay user (justamente para eso es). El resto de /play/* sí está protegido.
  const isLoginPage = pathname === '/play/login';

  useEffect(() => {
    if (isLoginPage) return;
    if (!loading && !user) router.replace('/play/login');
  }, [user, loading, router, isLoginPage]);

  // El login page se renderiza sin el chrome (header/footer) y sin guard.
  if (isLoginPage) {
    return (
      <div style={brandingStyle}>{children}</div>
    );
  }

  // Loading state — evitamos flash de contenido protegido.
  if (loading || !user) {
    return (
      <div
        style={brandingStyle}
        className="flex min-h-screen items-center justify-center bg-[var(--color-bg)]"
      >
        <div
          className="size-1 bg-[var(--color-accent)] animate-pulse"
          aria-label="Cargando"
        />
      </div>
    );
  }

  return (
    <div
      style={brandingStyle}
      className="relative flex min-h-screen flex-col bg-[var(--color-bg)]"
    >
      {/* Sprint 51.16: fondo animado con orbs + grain detrás de TODO */}
      <PlatformBackground />
      <PlayerHeader logoUrl={branding?.logoUrl ?? null} />
      {/* Padding-bottom para no quedar tapado por PlayerBottomNav en mobile (h-16 + safe-area) */}
      <main className="flex-1 pb-20 md:pb-0">{children}</main>
      <PlayerFooter />
      {/* Sprint 51.11: bottom nav mobile-only + floating league widget */}
      <PlayerBottomNav />
      <FloatingLeagueWidget />
      {/* Sprint 51.17: toast de celebración cuando el balance sube */}
      <WinToastWatcher />
    </div>
  );
}

function PlayerFooter() {
  return (
    <footer className="border-t border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
      <div className="max-w-[1100px] mx-auto px-6 py-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-[11px] text-[var(--color-fg-subtle)]">
        <div className="flex items-center gap-4">
          <span className="font-display tracking-tight text-[var(--color-fg-muted)]">
            Plataforma Casino
          </span>
          <span className="uppercase tracking-[0.12em]">
            Juego responsable · +18
          </span>
        </div>
        <div className="flex items-center gap-4">
          <a href="/play" className="hover:text-[var(--color-fg)] transition-colors">
            Inicio
          </a>
          <a
            href="/play/wallet"
            className="hover:text-[var(--color-fg)] transition-colors"
          >
            Wallet
          </a>
          <a
            href="/play/bonuses"
            className="hover:text-[var(--color-fg)] transition-colors"
          >
            Bonos
          </a>
        </div>
      </div>
    </footer>
  );
}
