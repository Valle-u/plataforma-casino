/**
 * Player layout — monta el chrome del jugador.
 *
 * Public browsing: unauthenticated users can browse the casino, see games,
 * and view the home page. Login/register are modals, not separate pages.
 *
 * Chrome (shell global):
 *   - Desktop: <PlayerSidebar/> (248px) + <PlayerTopHeader/>
 *   - Mobile: <PlayerMobileAppBar/> + <PlayerBottomNav/>
 *
 * Sesión: comparte el mismo `AuthProvider` que el admin (root layout).
 * Operators (canAccessPanel) are redirected to /dashboard.
 */

'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { LoginModal } from '@/components/player/login-modal';
import { MaintenanceScreen } from '@/components/player/maintenance-screen';
import { RegisterModal } from '@/components/player/register-modal';
import { PlatformBackground } from '@/components/player/platform-background';
import { PlayerBottomNav } from '@/components/player/shell/player-bottom-nav';
import { PlayerMobileAppBar } from '@/components/player/shell/player-mobile-appbar';
import { PlayerMobileSidebar } from '@/components/player/shell/player-mobile-sidebar';
import { PlayerSidebar } from '@/components/player/shell/player-sidebar';
import { PlayerTopHeader } from '@/components/player/shell/player-top-header';
import { WelcomeTour } from '@/components/player/welcome-tour';
import { WinToastWatcher } from '@/components/player/win-toast-watcher';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';
import { useTenantInfo } from '@/lib/hooks/use-tenant-branding';
import { themeToStyle, useTheme } from '@/lib/hooks/use-theme';
import { normalizeStorageUrl } from '@/lib/storage-url';
import { applyTenantFavicon } from '@/lib/tenant-favicon';

export default function PlayerLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading, authModal, openLoginModal, openRegisterModal, closeAuthModal } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const openSidebar = useCallback(() => setSidebarOpen(true), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

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
        bgColor: '--color-bg', bgElevated: '--color-bg-elevated', bgSubtle: '--color-bg-subtle',
        fgColor: '--color-fg', fgMuted: '--color-fg-muted', fgSubtle: '--color-fg-subtle',
        borderColor: '--color-border', borderStrong: '--color-border-strong',
        accentColor: '--color-accent', accentHover: '--color-accent-hover',
        accentFg: '--color-accent-fg', accentText: '--color-accent-text',
        accentSubtle: '--color-accent-subtle', accentBorder: '--color-accent-border',
        success: '--color-success', warning: '--color-warning',
        magenta: '--color-magenta', cyan: '--color-cyan', purple: '--color-purple', gold: '--color-gold',
      };
      for (const [key, cssVar] of Object.entries(colorMap)) {
        const val = designColors[key];
        if (val) vars[cssVar] = val;
      }
    }
    if (branding?.primaryColor) vars['--color-accent'] = branding.primaryColor;
    return vars;
  }, [branding?.primaryColor, theme, tenantInfo.data?.design?.colors]);

  // Favicon dinámico
  // Sprint 55.10: applyTenantFavicon re-encodifica a PNG porque Chrome no
  // aplica favicons WEBP inyectados dinámicamente (ver lib/tenant-favicon.ts).
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const designBrand = tenantInfo.data?.design?.brand as { faviconUrl?: string } | undefined;
    const faviconUrl = designBrand?.faviconUrl || branding?.faviconUrl || branding?.logoUrl;
    if (!faviconUrl) return;
    applyTenantFavicon(normalizeStorageUrl(faviconUrl));
  }, [branding?.logoUrl, branding?.faviconUrl, tenantInfo.data?.design]);

  // Auto-open login/register modal from query params (?auth=login|register, ?ref=, ?next=)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const authParam = params.get('auth');
    const refParam = params.get('ref');
    const nextParam = params.get('next');
    if (authParam === 'login' && !user) {
      openLoginModal(nextParam ?? undefined);
      const url = new URL(window.location.href);
      url.searchParams.delete('auth');
      url.searchParams.delete('next');
      window.history.replaceState({}, '', url.toString());
    } else if (authParam === 'register' && !user) {
      openRegisterModal(refParam ?? undefined, nextParam ?? undefined);
      const url = new URL(window.location.href);
      url.searchParams.delete('auth');
      url.searchParams.delete('ref');
      url.searchParams.delete('next');
      window.history.replaceState({}, '', url.toString());
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isGameFrame = /^\/play\/games\/[^/]+\/play\/iframe/.test(pathname);

  // Redirect operators to /dashboard
  useEffect(() => {
    if (loading) return;
    if (user?.canAccessPanel) router.replace('/dashboard');
  }, [user, loading, router]);

  // Loading state
  if (loading) {
    return (
      <div style={brandingStyle} className="flex min-h-screen items-center justify-center bg-[var(--color-bg)]">
        <div className="size-1 bg-[var(--color-accent)] animate-pulse" aria-label="Cargando" />
      </div>
    );
  }

  // Operators bouncing to admin panel
  if (user?.canAccessPanel) {
    return (
      <div style={brandingStyle} className="flex min-h-screen items-center justify-center bg-[var(--color-bg)]">
        <div className="size-1 bg-[var(--color-accent)] animate-pulse" aria-label="Redirigiendo" />
      </div>
    );
  }

  // Site maintenance — blocks everything under /play (LEYES: operadores no
  // afectados; ya fueron redirigidos a /dashboard arriba).
  if (tenantInfo.data?.site.maintenanceEnabled) {
    return (
      <div style={brandingStyle} className="relative min-h-screen bg-[var(--color-bg)]">
        <MaintenanceScreen />
      </div>
    );
  }

  // Game iframe: fullscreen
  if (isGameFrame) {
    return (
      <div style={brandingStyle} className="relative h-[100dvh] overflow-hidden bg-black">
        {children}
        <WinToastWatcher />
      </div>
    );
  }

  // Full chrome — works for both guests and authenticated users
  return (
    <div style={brandingStyle} className={cn('relative min-h-screen bg-[var(--color-bg)]', isImpersonating && 'pt-8')}>
      <PlatformBackground />
      <a href="#play-main" className="skip-to-content">Saltar al contenido</a>

      <div className="lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
        <div className="hidden lg:block">
          <PlayerSidebar />
        </div>
        <div className="flex min-h-screen flex-col">
          <div className="hidden lg:block">
            <PlayerTopHeader />
          </div>
          <div className="lg:hidden">
            <PlayerMobileAppBar onOpenSidebar={openSidebar} />
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

      <PlayerMobileSidebar open={sidebarOpen} onClose={closeSidebar} />

      <WinToastWatcher />
      <WelcomeTour />

      {/* Auth modals — globally available via auth context */}
      <LoginModal
        open={authModal.loginOpen}
        onOpenChange={(v) => v ? openLoginModal(authModal.next) : closeAuthModal()}
        next={authModal.next}
        onSwitchToRegister={() => openRegisterModal(undefined, authModal.next)}
      />
      <RegisterModal
        open={authModal.registerOpen}
        onOpenChange={(v) => v ? openRegisterModal(authModal.registerRef, authModal.next) : closeAuthModal()}
        refCode={authModal.registerRef}
        next={authModal.next}
        onSwitchToLogin={() => openLoginModal(authModal.next)}
      />
    </div>
  );
}
