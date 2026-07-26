/**
 * Root layout — fuentes + providers globales + meta.
 *
 * Fuentes (design system "Neón Milonga" / Casino TANGO):
 *   - Outfit (display) → headings, wordmarks, números grandes.
 *   - Inter (sans) → UI body + números tabulares.
 *   - Geist Mono → IDs, hashes, código técnico del panel admin.
 *
 * Cargadas via `next/font/google` para auto-optimization + zero CLS.
 * Las inyectamos como CSS variables (--font-*) que `globals.css` consume.
 */

import type { Metadata } from 'next';
import { Geist_Mono, Inter, Outfit } from 'next/font/google';
import { Toaster } from 'sonner';
import { ImpersonateBanner } from '@/components/impersonate-banner';
import { DynamicTitleUpdater } from '@/components/dynamic-title-updater';
import { AuthProvider } from '@/lib/auth-context';
import { QueryProvider } from '@/lib/query-client';
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
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es-AR" className={`${outfit.variable} ${inter.variable} ${geistMono.variable}`}>
      <body className="min-h-screen bg-grain antialiased">
        <QueryProvider>
          <AuthProvider>
            <DynamicTitleUpdater />
            <ImpersonateBanner />
            {children}
          </AuthProvider>
        </QueryProvider>
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
