/**
 * Player layout — monta el chrome "Neón Milonga" (Casino TANGO).
 *
 * Public browsing: unauthenticated users can browse the casino, see games,
 * and view the home page. When they try to play a game or access protected
 * features, they're prompted to log in or register.
 *
 * Chrome (shell global):
 *   - Desktop: <PlayerSidebar/> (248px) + <PlayerTopHeader/>
 *   - Mobile: <PlayerMobileAppBar/> + <PlayerBottomNav/>
 *   - Guest mode: simplified chrome with login/register CTAs.
 *
 * Sesión: comparte el mismo `AuthProvider` que el admin (root layout).
 * Operators (canAccessPanel) are redirected to /dashboard.
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

  const tenantInfo = useTenantInfo();
  const branding = tenantInfo.data?.branding;

  const { theme } = useTheme();
  const isImpersonating = !!user?.impersonatedBy;

  const brandingStyle = useMemo<CSSProperties | undefined>(() => {
    const themeVars = themeToStyle(theme);

    const designColors = tenantInfo.data?.design?.colors as Record<string, string> | undefined;
    if (!designColors && !branding?.primaryColor) return themeVars;

    const vars: Record<string, string | undefined> = {};

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

  // Favicon dinámico
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

  const isLoginPage = pathname === '/play/login';
  const isRegisterPage = pathname === '/play/register';
  const isGameFrame = /^\/play\/games\/[^/]+\/play\/iframe/.test(pathname);

  // Redirect operators to /dashboard
  useEffect(() => {
    if (loading) return;
    if (user?.canAccessPanel) router.replace('/dashboard');
  }, [user, loading, router]);

  // Login/Register pages: no chrome
  if (isLoginPage || isRegisterPage) {
    return (
      <div style={brandingStyle}>{children}</div>
    );
  }

  // Loading state
  if (loading) {
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

  // Operators bouncing to admin panel
  if (user?.canAccessPanel) {
    return (
      <div
        style={brandingStyle}
        className="flex min-h-screen items-center justify-center bg-[var(--color-bg)]"
      >
        <div
          className="size-1 bg-[var(--color-accent)] animate-pulse"
          aria-label="Redirigiendo"
        />
      </div>
    );
  }

  // Game iframe: fullscreen
  if (isGameFrame) {
    return (
      <div style={brandingStyle} className="relative h-[100dvh] overflow-hidden bg-black">
        {children}
        <WinToastWatcher />
        <AchievementUnlockWatcher />
      </div>
    );
  }

  // Full chrome — works for both guests and authenticated users
  return (
    <div
      style={brandingStyle}
      className={cn('relative min-h-screen bg-[var(--color-bg)]', isImpersonating && 'pt-8')}
    >
      <PlatformBackground />
      <a href="#play-main" className="skip-to-content">
        Saltar al contenido
      </a>

      <div className="lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
        {/* Sidebar — desktop only */}
        <div className="hidden lg:block">
          <PlayerSidebar />
        </div>

        {/* Columna de contenido */}
        <div className="flex min-h-screen flex-col">
          <div className="hidden lg:block">
            <PlayerTopHeader />
          </div>
          <div className="lg:hidden">
            <PlayerMobileAppBar />
          </div>

          <main id="play-main" className="flex-1 pb-24 lg:pb-0">
            <div key={pathname} className="animate-page-enter">
              {children}
            </div>
          </main>
        </div>
      </div>

      <div className="lg:hidden">
        <PlayerBottomNav />
      </div>

      <WinToastWatcher />
      <AchievementUnlockWatcher />
      <WelcomeTour />
    </div>
  );
}
