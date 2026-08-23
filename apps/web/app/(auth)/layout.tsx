/**
 * Auth layout — puerta del PANEL.
 *
 * Acoplado al lenguaje del panel (no a un look de "consola"): fondo del panel
 * (`.admin-neutral`), tarjeta y componentes del design system, monocromático.
 * Se scopea a `.admin-neutral` SIN inyectar el acento del tenant, así el CTA y
 * el foco caen en el gris del fallback (mismo look que el panel, sin color). El
 * favicon es el fijo del panel.
 */

'use client';

import { useEffect, type ReactNode } from 'react';
import { applyPanelFavicon } from '@/lib/tenant-favicon';

export default function AuthLayout({ children }: { children: ReactNode }) {
  useEffect(() => {
    document.body.classList.add('admin-neutral');
    applyPanelFavicon();
    return () => document.body.classList.remove('admin-neutral');
  }, []);

  return (
    <div className="admin-neutral relative flex min-h-screen items-center justify-center bg-[var(--color-bg)] px-5 py-10 text-[var(--color-fg)]">
      {/* Realce radial muy sutil para levantar el centro (sin retícula ni barras). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(600px 400px at 50% 35%, rgba(255,255,255,0.025), transparent 70%)',
        }}
      />
      <div className="relative z-10 w-full max-w-[380px]">{children}</div>
    </div>
  );
}
