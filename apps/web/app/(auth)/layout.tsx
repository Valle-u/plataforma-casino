/**
 * Auth layout — puerta del PANEL, monocromática (rediseño v2).
 *
 * A diferencia del sitio del jugador, el login NO tiene marca ni color del
 * tenant: es la puerta de la consola de operación. Se scopea a `.admin-neutral`
 * (paleta gris del panel) SIN inyectar acento, así el CTA/foco caen en gris y
 * no en el rosa del tema del jugador. La única marca es la del producto
 * (`PanelMark`), siempre monocromática. El favicon también es el fijo del panel.
 *
 * Chrome: barra superior + barra inferior de estado + fondo de retícula técnica.
 * El contenido (encabezado + tarjeta + nota) vive en la página.
 */

'use client';

import { useEffect, type ReactNode } from 'react';
import { PanelMark } from '@/components/brand/panel-mark';
import { applyPanelFavicon } from '@/lib/tenant-favicon';

const TENANT = (process.env.NEXT_PUBLIC_TENANT_HOST ?? 'demo.localhost').split(
  '.',
)[0];

export default function AuthLayout({ children }: { children: ReactNode }) {
  useEffect(() => {
    document.body.classList.add('admin-neutral');
    applyPanelFavicon();
    return () => document.body.classList.remove('admin-neutral');
  }, []);

  return (
    <div className="admin-neutral relative flex min-h-screen flex-col bg-[var(--color-bg)] text-[var(--color-fg)]">
      {/* Fondo: retícula técnica + realce radial sutil (solo desktop). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(#141414 1px, transparent 1px), linear-gradient(90deg, #141414 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          opacity: 0.5,
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 hidden lg:block"
        style={{
          background:
            'radial-gradient(720px 480px at 50% 30%, rgba(255,255,255,.035), transparent 70%)',
        }}
      />

      {/* Barra superior. */}
      <header className="relative z-10 flex h-[52px] shrink-0 items-center justify-between border-b border-[#1a1a1a] px-5 sm:px-6">
        <div className="flex items-center gap-[11px]">
          <PanelMark size={26} />
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#8a8a8a]">
            Panel de control
          </span>
        </div>
        <div className="flex items-center gap-[18px] font-mono text-[11px] text-[#5c5c5c]">
          <span className="hidden sm:inline">tenant://{TENANT}</span>
          <span>v0.1.0</span>
        </div>
      </header>

      {/* Centro. */}
      <main className="relative z-10 flex flex-1 items-center justify-center px-5 py-8">
        {children}
      </main>

      {/* Barra inferior — texto de sistema, sin navegación. */}
      <footer className="relative z-10 flex h-11 shrink-0 items-center justify-between border-t border-[#1a1a1a] px-5 font-mono text-[10.5px] text-[#4d4d4d] sm:px-6">
        <span className="sm:hidden">tenant://{TENANT}</span>
        <span className="hidden sm:inline">build 2026.08</span>
        <span className="sm:hidden">build 2026.08</span>
        <span className="hidden sm:inline">uptime 99.97%</span>
      </footer>
    </div>
  );
}
