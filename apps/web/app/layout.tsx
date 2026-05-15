/**
 * Root layout — fuentes + providers globales + meta.
 *
 * Fuentes:
 *   - Fraunces (display, serif variable) → headings importantes.
 *   - Geist (sans) → UI body.
 *   - Geist Mono → números, IDs, hashes.
 *
 * Cargadas via `next/font/google` para auto-optimization + zero CLS.
 * Las inyectamos como CSS variables (--font-*) que `globals.css` consume.
 */

import type { Metadata } from 'next';
import { Fraunces, Geist, Geist_Mono } from 'next/font/google';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/lib/auth-context';
import { QueryProvider } from '@/lib/query-client';
import './globals.css';

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  // Variable font — pesos via font-weight CSS; opsz axis para optical
  // sizing automático según tamaño del texto.
  axes: ['opsz', 'SOFT'],
});

const geistSans = Geist({
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
  description: 'Panel administrativo del operador.',
  robots: 'noindex, nofollow',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es-AR" className={`${fraunces.variable} ${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-screen bg-grain antialiased">
        <QueryProvider>
          <AuthProvider>{children}</AuthProvider>
        </QueryProvider>
        {/* Toaster con estilos que matchean el DS — sin radius, fondo
            elevated, borde 1px. Position bottom-right por convención. */}
        <Toaster
          position="bottom-right"
          theme="dark"
          toastOptions={{
            unstyled: false,
            classNames: {
              toast:
                '!bg-[var(--color-bg-elevated)] !text-[var(--color-fg)] !border !border-[var(--color-border-strong)] !rounded-none !shadow-none',
              title: '!font-medium !text-[13px] !tracking-tight',
              description: '!text-[12px] !text-[var(--color-fg-muted)]',
              error:
                '!bg-[var(--color-accent-subtle)] !border-[var(--color-accent-border)] !text-[var(--color-fg)]',
              success:
                '!bg-[var(--color-success-bg)] !border-[var(--color-success)] !text-[var(--color-fg)]',
            },
          }}
        />
      </body>
    </html>
  );
}
