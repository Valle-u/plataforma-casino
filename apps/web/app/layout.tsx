/**
 * Root layout — fuentes + providers globales + meta.
 *
 * Fuentes:
 *   - Outfit (display) → headings, wordmarks, números grandes.
 *   - Inter (sans) → UI body + números tabulares.
 *   - Geist Mono → IDs, hashes, código técnico del panel admin.
 *
 * Cargadas via `next/font/google` para auto-optimization + zero CLS.
 * Las inyectamos como CSS variables (--font-*) que `globals.css` consume.
 */

import type { Metadata, Viewport } from 'next';
import { Geist_Mono, Inter, Outfit } from 'next/font/google';
import { Toaster } from 'sonner';
import { ErrorBoundary } from '@sentry/nextjs';
import { ImpersonateBanner } from '@/components/impersonate-banner';
import { DynamicTitleUpdater } from '@/components/dynamic-title-updater';
import { RegisterServiceWorker } from '@/components/pwa/register-sw';
import { AuthProvider } from '@/lib/auth-context';
import { QueryProvider } from '@/lib/query-client';
import { getServerUser } from '@/lib/server-api';
import './globals.css';

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Plataforma Casino',
    template: '%s · Plataforma Casino',
  },
  description: 'Tu reino. Tus reglas. Tu juego.',
  robots: 'noindex, nofollow',
  // Sprint 55.x: PWA en iOS. `appleWebApp.capable` + `statusBarStyle`
  // hacen que "Agregar a pantalla de inicio" abra la app standalone.
  // `viewportFit: cover` en `viewport` habilita `env(safe-area-inset-*)`.
  applicationName: 'Plataforma Casino',
  appleWebApp: {
    capable: true,
    title: 'Plataforma Casino',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    // ⚠️ NO declarar `icon:` acá. Next lo emite como <link rel="icon"> y React
    // 19 lo iza como HostHoistable (fiber tag 26). El favicon dinámico por
    // tenant (lib/tenant-favicon.ts) inyecta su propio <link rel="icon"> y,
    // para ganarle a Chrome, antes borraba los estáticos con `.remove()` —
    // pero borrar un nodo hoistado por React deja su fiber con parentNode=null
    // y en la próxima navegación React crashea en loop en
    // `parentNode.removeChild` ("Cannot read properties of null"), congelando
    // el render (bug del "doble click"). Al no declararlos acá, no hay ningún
    // <link rel="icon"> gestionado por React → el favicon del tenant es el
    // único y gana sin conflicto. Los iconos de instalación PWA vienen del
    // manifest (app/manifest.ts), no de estos links. Ver docs/DEVLOG.md.
    // Ruta generada por tenant (app/icons/tenant-icon/route.tsx), NO un PNG
    // estático: el estático era la "T" de Turborepo del andamiaje. Relativa a
    // propósito — la ruta resuelve el tenant por el header Host.
    apple: [
      { url: '/icons/tenant-icon.png?size=180', sizes: '180x180', type: 'image/png' },
    ],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0a0a0a',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Kill-switch server-side (Etapa 2, Fase B): con `SSR_AUTH=1` resolvemos el
  // user en el servidor (leyendo la cookie) y lo sembramos en el AuthProvider,
  // así el panel se renderiza server-side. Apagado (default) → el user se
  // resuelve client-side como siempre (comportamiento previo). Cambiar el flag
  // en Vercel + redeploy revierte sin tocar código. Leer cookies() solo cuando
  // está prendido evita volver dinámica toda la app cuando está apagado.
  const initialUser =
    process.env.SSR_AUTH === '1' ? await getServerUser() : null;
  return (
    <html lang="es-AR" className={`${outfit.variable} ${inter.variable} ${geistMono.variable}`}>
      <body className="min-h-screen bg-grain antialiased">
        <ErrorBoundary>
          <QueryProvider>
            <AuthProvider initialUser={initialUser}>
              <DynamicTitleUpdater />
              <RegisterServiceWorker />
              <ImpersonateBanner />
              {children}
            </AuthProvider>
          </QueryProvider>
        </ErrorBoundary>
        {/* Toaster — Sprint 51.25 premium upgrade.
            Antes: rounded-none + shadow-none (look terminal del DS viejo).
            Ahora: rounded-lg + sombra layered + edge highlight + glass blur
            (alineado con .surface-glass del DS). */}
        <Toaster
          position="bottom-right"
          theme="dark"
          toastOptions={{
            unstyled: false,
            classNames: {
              toast:
                '!bg-[var(--color-bg-elevated)]/90 !backdrop-blur-md !text-[var(--color-fg)] !border !border-[var(--color-border-strong)] !rounded-[var(--radius-lg)] !shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06),0_18px_48px_-12px_rgba(0,0,0,0.7),0_8px_16px_-6px_rgba(0,0,0,0.4)]',
              title: '!font-medium !text-[13px] !tracking-tight',
              description: '!text-[12px] !text-[var(--color-fg-muted)]',
              error:
                '!bg-[var(--color-accent-subtle)]/90 !border-[var(--color-accent)] !text-[var(--color-fg)]',
              success:
                '!bg-[var(--color-success-bg)]/90 !border-[var(--color-success)] !text-[var(--color-fg)]',
              warning:
                '!bg-[var(--color-warning-bg)]/90 !border-[var(--color-warning)] !text-[var(--color-fg)]',
              info:
                '!bg-[var(--color-bg-elevated)]/90 !border-[var(--color-info)] !text-[var(--color-fg)]',
            },
          }}
        />
      </body>
    </html>
  );
}
