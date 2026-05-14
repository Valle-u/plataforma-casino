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
import { AuthProvider } from '@/lib/auth-context';
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
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
