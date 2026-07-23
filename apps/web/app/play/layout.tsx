/**
 * Player layout — protege rutas (redirige a /play/login si no hay sesión)
 * y monta el chrome compartido "Neón Milonga" (Casino TANGO).
 *
 * Chrome (shell global, una sola vez para todas las /play/*):
 *   - Desktop: <PlayerSidebar/> (248px, 4 grupos de nav + VIP card) +
 *     <PlayerTopHeader/> (buscador, saldo, Depositar, campana, avatar).
 *   - Mobile: <PlayerMobileAppBar/> arriba + <PlayerBottomNav/> (5 tabs).
 *   - El item activo lo resuelve cada componente por pathname.
 *
 * Sesión: comparte el mismo `AuthProvider` que el admin (root layout).
 * Solo los `usuario_final` (jugadores) acceden a /play: si el user tiene
 * panel access (operador), lo redirigimos a /dashboard. Para "ver lo que
 * ve el jugador" el admin debe impersonar un usuario_final (ahí la
 * identidad pasa a ser player y `canAccessPanel` queda en false).
 */

'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, type CSSProperties, type ReactNode } from 'react';
import { AchievementUnlockWatcher } from '@/components/player/achievement-unlock-watcher';
import { PlatformBackground } from '@/components/player/platform-background';
import { PlayerBottomNav } from '@/components/player/shell/player-bottom-nav';
import { PlayerMobileAppBar } from '@/components/player/shell/player-mobile-appbar';
import { PlayerSidebar } from '@/components/player/shell/player-sidebar';
import { PlayerTopHeader } from '@/components/player/shell/player-top-header';
import { WelcomeTour } from '@/components/player/welcome-tour';
import { WinToastWatcher } from '@/components/player/win-toast-watcher';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';
import { useTenantInfo } from '@/lib/hooks/use-tenant-branding';
import { themeToStyle, useTheme } from '@/lib/hooks/use-theme';
import { normalizeStorageUrl } from '@/lib/storage-url';

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

  // Sprint 51.29: theme preference del player (4 colores). El branding
  // del tenant SIEMPRE gana — se aplica DESPUÉS del theme en el spread,
  // así si hay primaryColor del tenant, el theme del player no pisa.
  const { theme } = useTheme();
  const isImpersonating = !!user?.impersonatedBy;

  const brandingStyle = useMemo<CSSProperties | undefined>(() => {
    const themeVars = themeToStyle(theme);

    // Colores del diseño config (si existen, pisan los del theme)
    const designColors = tenantInfo.data?.design?.colors as Record<string, string> | undefined;
    if (!designColors && !branding?.primaryColor) return themeVars;

    const vars: Record<string, string | undefined> = {};

    // Spread theme vars
    for (const [k, v] of Object.entries(themeVars)) {
      if (typeof v === 'string') vars[k] = v;
    }

    if (designColors) {
      const colorMap: Record<string, string> = {
        bgColor: '--color-bg',
        bgElevated: '--color-bg-elevated',
        bgSubtle: '--color-bg-subtle',
        fgColor: '--color-fg',
        fgMuted: '--color-fg-muted',
        fgSubtle: '--color-fg-subtle',
        borderColor: '--color-border',
        borderStrong: '--color-border-strong',
        accentColor: '--color-accent',
        accentHover: '--color-accent-hover',
        accentFg: '--color-accent-fg',
        accentText: '--color-accent-text',
        accentSubtle: '--color-accent-subtle',
        accentBorder: '--color-accent-border',
        success: '--color-success',
        warning: '--color-warning',
        magenta: '--color-magenta',
        cyan: '--color-cyan',
        purple: '--color-purple',
        gold: '--color-gold',
      };
      for (const [key, cssVar] of Object.entries(colorMap)) {
        const val = designColors[key];
        if (val) vars[cssVar] = val;
      }
    }

    if (branding?.primaryColor) {
      vars['--color-accent'] = branding.primaryColor;
    }

    return vars;
  }, [branding?.primaryColor, theme, tenantInfo.data?.design?.colors]);

  // Favicon dinámico: prioridad design.config (público) > branding.logoUrl > default
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const designBrand = tenantInfo.data?.design?.brand as { faviconUrl?: string } | undefined;
    const faviconUrl = designBrand?.faviconUrl || branding?.logoUrl;
    if (!faviconUrl) return;
    const head = document.head;
    const existing = head.querySelector<HTMLLinkElement>(
      'link[rel="icon"][data-tenant-branding]',
    );
    const link = existing ?? document.createElement('link');
    link.rel = 'icon';
    link.setAttribute('data-tenant-branding', '1');
    link.href = normalizeStorageUrl(faviconUrl);
    if (!existing) head.appendChild(link);
    return () => {
      link.remove();
    };
  }, [branding?.logoUrl, tenantInfo.data?.design]);

  // El login page tiene su propia UI fullscreen y NO debe redirigir si no
  // hay user (justamente para eso es). El resto de /play/* sí está protegido.
  const isLoginPage = pathname === '/play/login';
  // Game iframe: ruta /play/games/[code]/play/iframe → render SIN chrome,
  // pantalla completa para máxima inmersión. El juego tiene su propio HUD.
  const isGameFrame = /^\/play\/games\/[^/]+\/play\/iframe/.test(pathname);

  useEffect(() => {
    if (isLoginPage || loading) return;
    if (!user) {
      router.replace('/play/login');
      return;
    }
    // Los operadores (admin/socio/distribuidor/cajero/empleado) NO usan
    // /play — los mandamos al panel. Para "ver lo que ve el jugador" hay
    // que impersonar un usuario_final (ahí canAccessPanel pasa a false).
    if (user.canAccessPanel) router.replace('/dashboard');
  }, [user, loading, router, isLoginPage]);

  // El login page se renderiza sin el chrome (header/footer) y sin guard.
  if (isLoginPage) {
    return (
      <div style={brandingStyle}>{children}</div>
    );
  }

  // Loading state — evitamos flash de contenido protegido. Los operadores
  // (canAccessPanel) también caen acá mientras el effect los redirige al panel.
  if (loading || !user || user.canAccessPanel) {
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

  // ── Game iframe: layout fullscreen sin chrome ──
  // El juego ocupa toda la pantalla. El HUD del juego maneja sus propios
  // controles (back, saldo, fullscreen). No sidebar, no appbar, no bottom nav.
  if (isGameFrame) {
    return (
      <div style={brandingStyle} className="relative h-[100dvh] overflow-hidden bg-black">
        {children}
        <WinToastWatcher />
        <AchievementUnlockWatcher />
      </div>
    );
  }

  return (
    <div
      style={brandingStyle}
      className={cn('relative min-h-screen bg-[var(--color-bg)]', isImpersonating && 'pt-8')}
    >
      {/* Fondo animado con orbs + grain detrás de TODO */}
      <PlatformBackground />
      {/* a11y: skip-to-content para keyboard users */}
      <a href="#play-main" className="skip-to-content">
        Saltar al contenido
      </a>

      {/* Chrome compartido "Neón Milonga" (Casino TANGO): sidebar global
       * (desktop) + header desktop / app bar mobile + nav inferior mobile.
       * Envuelve TODAS las páginas de /play — el item activo lo resuelve
       * cada componente por pathname. */}
      <div className="lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
        {/* Sidebar — desktop only */}
        <div className="hidden lg:block">
          <PlayerSidebar />
        </div>

        {/* Columna de contenido */}
        <div className="flex min-h-screen flex-col">
          {/* Header desktop / app bar mobile */}
          <div className="hidden lg:block">
            <PlayerTopHeader />
          </div>
          <div className="lg:hidden">
            <PlayerMobileAppBar />
          </div>

          {/* Sprint 51.26: key={pathname} fuerza remount → animate-page-enter.
           * pb en mobile para no quedar tapado por el nav inferior. */}
          <main id="play-main" className="flex-1 pb-24 lg:pb-0">
            <div key={pathname} className="animate-page-enter">
              {children}
            </div>
          </main>
        </div>
      </div>

      {/* Nav inferior — mobile only */}
      <div className="lg:hidden">
        <PlayerBottomNav />
      </div>

      {/* Toasts de notificación REAL (gané, achievement unlock) — señal
       * verdadera, activos en todas las páginas. */}
      <WinToastWatcher />
      <AchievementUnlockWatcher />
      {/* Tour de bienvenida — one-shot. */}
      <WelcomeTour />
    </div>
  );
}
