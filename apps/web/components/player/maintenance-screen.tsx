/**
 * MaintenanceScreen — pantalla de mantenimiento del player.
 *
 * Se muestra cuando `site.maintenance_enabled = true` (GET /tenant/info).
 * Bloquea TODO el /play: no se juega, no se entra. El panel admin no se ve
 * afectado (el operador es redirigido a /dashboard antes de llegar acá).
 */

'use client';

import { Wrench } from 'lucide-react';
import { BrandWordmark } from '@/components/brand/brand-wordmark';
import { useTenantInfo } from '@/lib/hooks/use-tenant-branding';

export function MaintenanceScreen() {
  const tenantInfo = useTenantInfo();
  const branding = tenantInfo.data?.branding;
  const designBrand = tenantInfo.data?.design?.brand as { logoUrl?: string } | undefined;
  const logoUrl = branding?.logoUrl || designBrand?.logoUrl;
  const tagline = branding?.tagline;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 px-6 text-center">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage: `radial-gradient(ellipse 60% 40% at 50% 20%, var(--color-accent-glow) 0%, transparent 60%)`,
        }}
      />

      <div className="relative flex flex-col items-center gap-5">
        <BrandWordmark size="lg" src={logoUrl} />
        {tagline && (
          <span className="text-[11px] uppercase tracking-[0.22em] text-[var(--color-accent-text)]">
            {tagline}
          </span>
        )}
      </div>

      <div className="relative flex flex-col items-center gap-3 max-w-md">
        <div className="flex size-14 items-center justify-center rounded-full border border-[var(--color-accent-border)] bg-[var(--color-accent-subtle)]">
          <Wrench className="size-6 text-[var(--color-accent-text)]" />
        </div>
        <h1 className="font-display text-3xl leading-tight tracking-tight">
          Estamos en mantenimiento
        </h1>
        <p className="text-sm text-[var(--color-fg-muted)] leading-relaxed">
          Estamos trabajando para mejorar la experiencia. El casino vuelve a
          estar disponible en breve. Gracias por la paciencia.
        </p>
      </div>

      <div className="relative text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)]">
        Juego responsable · +18
      </div>
    </div>
  );
}
