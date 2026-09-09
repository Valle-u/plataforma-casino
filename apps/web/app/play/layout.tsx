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
 * Operators (canAccessPanel) are redirected to /dashboard — pero SOLO desde un
 * host donde el panel exista (ver `lib/host-del-panel.ts`).
 */

'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { LoginModal } from '@/components/player/login-modal';
import { MaintenanceScreen } from '@/components/player/maintenance-screen';
import { RegisterModal } from '@/components/player/register-modal';
import { PlatformBackground } from '@/components/player/platform-background';
import { PlayerBottomNav } from '@/components/player/shell/player-bottom-nav';
import { PlayerMobileAppBar } from '@/components/player/shell/player-mobile-appbar';
import { PlayerMobileSidebar } from '@/components/player/shell/player-mobile-sidebar';
import { PlayerLoadingScreen } from '@/components/player/shell/player-loading-screen';
import { PlayerSidebar } from '@/components/player/shell/player-sidebar';
import { PlayerTopHeader } from '@/components/player/shell/player-top-header';
import { WelcomeTour } from '@/components/player/welcome-tour';
import { WinToastWatcher } from '@/components/player/win-toast-watcher';
import { ChatWidget } from '@/components/player/chat/chat-widget';
import { CRM_ENABLED } from '@/lib/chat/flag';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';
import { elPanelViveEnEsteHost } from '@/lib/host-del-panel';
import { useTenantInfo } from '@/lib/hooks/use-tenant-branding';
import { themeToStyle, useTheme } from '@/lib/hooks/use-theme';
import { normalizeStorageUrl } from '@/lib/storage-url';
import { applyTenantFavicon } from '@/lib/tenant-favicon';
import { PLAYER_THEME_CLASS, injectPlayerVars } from '@/lib/player-appearance';
import { variablesDeColorDelTenant } from '@/lib/tenant-color-vars';

/**
 * Saca `auth` y `next` del URL sin recargar ni ensuciar el historial.
 *
 * `ref` se queda a propósito: el diseño del socio se arma con él (y queda
 * congelado en sessionStorage, pero tenerlo en el URL es el respaldo y hace
 * que el link se pueda compartir).
 */
function limpiarAuthDeLaUrl(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('auth') && !url.searchParams.has('next')) return;
  url.searchParams.delete('auth');
  url.searchParams.delete('next');
  window.history.replaceState({}, '', url.toString());
}

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

  const brandingStyle = useMemo<CSSProperties>(() => {
    // ⚠️ MIENTRAS NO SE SABE, NO SE PINTA.
    //
    // Un `style` en línea le gana a cualquier regla CSS, incluida la que el
    // servidor deja en `:root` con la paleta ya resuelta. Si acá se devolvieran
    // los valores por defecto mientras llega la respuesta, taparían la paleta
    // buena y el parpadeo volvería — **exactamente lo que pasó**: se pintaba el
    // HTML correcto y el propio cliente lo pisaba en el primer render.
    //
    // Devolviendo un objeto vacío, hasta que haya datos manda el `:root` del
    // servidor, que ya trae los colores del casino.
    if (!tenantInfo.data) return {};

    const themeVars = themeToStyle(theme);
    const base: Record<string, string> = {};
    for (const [k, v] of Object.entries(themeVars)) {
      if (typeof v === 'string') base[k] = v;
    }
    // El mapeo de colores y los degradados derivados viven en
    // `tenant-color-vars` porque el SERVIDOR usa exactamente los mismos para
    // pintar el primer HTML. Si acá hubiera una copia, cualquier diferencia
    // entre las dos aparecería como un cambio de color al hidratar.
    return variablesDeColorDelTenant(
      tenantInfo.data.design?.colors,
      branding?.primaryColor,
      base,
    );
  }, [branding?.primaryColor, theme, tenantInfo.data]);

  // Diseño del socio en los PORTALES (modales/menús/drawers). El `style`
  // inline de abajo cubre el contenido in-tree, pero los portales de Radix
  // cuelgan del <body> (fuera del wrapper) → sin esto heredarían el rosa del
  // :root. Espejo de lo que hace el panel admin: clase `player-themed` en el
  // <body> + regla `.player-themed{…}` en el <head> con los mismos vars.
  // La clase se pone/saca en mount/unmount (el panel admin sigue con su tema);
  // la regla se re-inyecta cuando cambian los colores.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.add(PLAYER_THEME_CLASS);
    return () => {
      document.body.classList.remove(PLAYER_THEME_CLASS);
      injectPlayerVars(null);
    };
  }, []);

  useEffect(() => {
    const vars = (brandingStyle ?? {}) as Record<string, string>;
    // Vacío = todavía no hay datos. No se inyecta la regla `.player-themed`
    // para no competir con el `:root` que dejó el servidor; se espera.
    if (Object.keys(vars).length === 0) return;
    injectPlayerVars(vars);
  }, [brandingStyle]);

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
  //
  // ⚠️ **Espera a que la sesión esté resuelta.** Antes corría en el montaje con
  // deps `[]`, y en ese instante `user` todavía es `null` aunque haya sesión:
  // el bootstrap de `AuthProvider` recién está preguntando `/tenant/auth/me`.
  // Resultado: quien ya tenía cuenta y abría un link de referido veía el
  // formulario "Creá tu cuenta" encima de su propio lobby, con su saldo
  // asomando detrás (verificado en staging el 2026-09-09).
  //
  // El `ref` corre igual, y sigue haciendo su trabajo: la marca del socio se
  // arma con él aunque el modal no se abra.
  //
  // ⚠️ **El `auth=` NO se borra al abrir.** Se borra recién cuando la persona
  // cierra el modal (ver `cerrarAuth`), y la razón es concreta:
  //
  // El link de referido se reparte por WhatsApp, y en iPhone WhatsApp abre los
  // links en su navegador interno (un `WKWebView`). Ese WebView **recarga la
  // página sola** cuando iOS le reclama memoria, y `/play` no es liviana: 60
  // juegos, carrusel, imágenes, una quincena de chunks.
  //
  // Borrando `auth` al abrir, la URL quedaba en `/play?ref=X` a los pocos
  // milisegundos. Cuando el WebView recargaba, volvía a esa URL —sin `auth`—
  // y el formulario **no volvía**. Desde afuera se ve como "se actualizó la
  // página y me sacó del registro", que es exactamente como lo reportó el
  // dueño el 2026-09-09, con el agravante de que le pasa al que todavía no
  // tiene cuenta: el link de referido no convierte.
  //
  // Dejándolo puesto, la recarga reabre el formulario donde estaba. Y si la
  // persona lo cierra a propósito, ahí sí se saca y no vuelve a molestar.
  const yaSeAutoAbrio = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // `loading` false = el bootstrap terminó y `user` ya es la verdad.
    if (loading || yaSeAutoAbrio.current) return;
    yaSeAutoAbrio.current = true;
    const params = new URLSearchParams(window.location.search);
    const authParam = params.get('auth');
    const refParam = params.get('ref');
    const nextParam = params.get('next');
    if (authParam === 'login' && !user) {
      openLoginModal(nextParam ?? undefined);
    } else if (authParam === 'register' && !user) {
      openRegisterModal(refParam ?? undefined, nextParam ?? undefined);
    } else if (authParam) {
      // Hay sesión: el pedido de abrir login o registro no aplica. Se saca del
      // URL, para que no quede colgado ni se reabra al compartir el link.
      limpiarAuthDeLaUrl();
    }
  }, [loading, user, openLoginModal, openRegisterModal]);

  /**
   * Cierre del modal de auth. Además de cerrarlo, saca `auth`/`next` del URL:
   * es el único momento en que sabemos que la persona **no quiere** el
   * formulario. `ref` se queda — el diseño del socio depende de él y hace que
   * el link siga siendo compartible.
   */
  const cerrarAuth = useCallback(() => {
    closeAuthModal();
    limpiarAuthDeLaUrl();
  }, [closeAuthModal]);

  const isGameFrame = /^\/play\/games\/[^/]+\/play\/iframe/.test(pathname);

  // ── Rebote de operadores al panel ────────────────────────────────────────
  //
  // Un operador que entra al sitio del jugador con su sesión de panel no tiene
  // nada que hacer acá, así que se lo manda a `/dashboard`.
  //
  // ⚠️ **Sólo donde `/dashboard` existe.** En el host del jugador esa ruta la
  // rebota el middleware a `/play`, y como el 307 llega sin los headers de
  // redirección de Next el router recarga la página entera. La recarga vuelve
  // a montar este layout, el efecto dispara otra vez, y la página se recarga
  // sola sin parar.
  //
  // Es el bug que rompió los links de referido el 2026-09-09: el formulario de
  // registro aparecía un instante y la página se reiniciaba. Ver
  // `lib/host-del-panel.ts`.
  //
  // Se resuelve en un efecto y no en el render porque `window` no existe
  // durante el SSR; hasta que resuelve vale `false`, o sea "no rebotar", que
  // es el lado seguro.
  const [panelAlcanzable, setPanelAlcanzable] = useState(false);
  useEffect(() => {
    setPanelAlcanzable(elPanelViveEnEsteHost(window.location.host));
  }, []);

  const rebotarAlPanel = panelAlcanzable && !!user?.canAccessPanel;

  useEffect(() => {
    if (loading) return;
    if (rebotarAlPanel) router.replace('/dashboard');
  }, [rebotarAlPanel, loading, router]);

  // Loading state
  if (loading) {
    return (
      <div style={brandingStyle}>
        <PlayerLoadingScreen />
      </div>
    );
  }

  // Operators bouncing to admin panel. En el host del jugador NO se rebota
  // (ver arriba): el operador ve el casino como cualquiera.
  if (rebotarAlPanel) {
    return (
      <div style={brandingStyle} className="flex min-h-screen items-center justify-center bg-[var(--color-bg)]">
        <div className="size-1 bg-[var(--color-accent)] animate-pulse" aria-label="Redirigiendo" />
      </div>
    );
  }

  // Site maintenance — blocks everything under /play.
  //
  // LEYES: los operadores no quedan afectados. Antes eso se cumplía de rebote
  // —ya estaban redirigidos a `/dashboard`—, pero en el host del jugador ya no
  // se los rebota, así que la excepción se escribe explícita.
  if (tenantInfo.data?.site.maintenanceEnabled && !user?.canAccessPanel) {
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
          {/* Mismo motivo que abajo: el sticky va en el wrapper. */}
          <div className="sticky top-0 z-30 hidden lg:block">
            <PlayerTopHeader />
          </div>
          {/* El `sticky` va ACÁ y no en el header.

              Un elemento sticky solo se pega dentro de la caja de su padre, y
              este wrapper mide exactamente lo mismo que el header (56px): con
              el sticky adentro, el header se iba con el scroll apenas
              empezabas a bajar. Estuvo declarado `sticky` desde el rediseño y
              nunca funcionó por eso. */}
          <div className="sticky top-0 z-30 lg:hidden">
            <PlayerMobileAppBar onOpenSidebar={openSidebar} />
          </div>
          <main id="play-main" className="flex-1 pb-24 lg:pb-0">
            {children}
          </main>
        </div>
      </div>

      <div className="lg:hidden">
        <PlayerBottomNav />
      </div>

      <PlayerMobileSidebar open={sidebarOpen} onClose={closeSidebar} />

      <WinToastWatcher />
      <WelcomeTour />

      {/* Livechat del jugador — solo con el flag ON y sesión (detrás de CRM_ENABLED). */}
      {CRM_ENABLED && user && <ChatWidget />}

      {/* Auth modals — globally available via auth context */}
      <LoginModal
        open={authModal.loginOpen}
        onOpenChange={(v) => (v ? openLoginModal(authModal.next) : cerrarAuth())}
        next={authModal.next}
        onSwitchToRegister={() => openRegisterModal(undefined, authModal.next)}
      />
      <RegisterModal
        open={authModal.registerOpen}
        onOpenChange={(v) => (v ? openRegisterModal(authModal.registerRef, authModal.next) : cerrarAuth())}
        refCode={authModal.registerRef}
        next={authModal.next}
        onSwitchToLogin={() => openLoginModal(authModal.next)}
      />
    </div>
  );
}
