/**
 * Auth layout — pantalla centrada con detalles visuales propios.
 *
 * Composición:
 *   - Lado izquierdo: panel con brand mark + tagline + grid sutil.
 *   - Lado derecho: formulario centrado.
 *   - Mobile: stack vertical, brand colapsa a header.
 *
 * El panel izquierdo trae "personalidad" del DS sin distraer del form:
 *   - Brand mark angular con detalle rojo.
 *   - Patrón de fondo (líneas diagonales sutiles).
 *   - Tagline corto con tipografía display.
 */

'use client';

import type { ReactNode } from 'react';

import { BrandWordmark } from '@/components/brand/brand-wordmark';
import { useTenantInfo } from '@/lib/hooks/use-tenant-branding';

export default function AuthLayout({ children }: { children: ReactNode }) {
  const tenantInfo = useTenantInfo();
  const branding = tenantInfo.data?.branding;
  const designBrand = tenantInfo.data?.design?.brand as { logoUrl?: string } | undefined;
  const logoUrl = branding?.logoUrl || designBrand?.logoUrl;
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      {/* ── Panel izquierdo: brand / atmósfera ─────────────── */}
      <aside className="relative hidden lg:flex flex-col justify-between p-12 overflow-hidden border-r border-[var(--color-border)]">
        {/* Patrón de fondo: líneas diagonales sutiles */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage: `repeating-linear-gradient(
              -45deg,
              transparent 0,
              transparent 24px,
              rgba(38, 38, 38, 0.4) 24px,
              rgba(38, 38, 38, 0.4) 25px
            )`,
          }}
        />
        {/* Glow sutil rojo en esquina top-right */}
        <div
          aria-hidden
          className="absolute -top-32 -right-32 size-96 rounded-full opacity-30 blur-3xl"
          style={{ background: 'var(--color-accent-glow)' }}
        />

        {/* Brand mark */}
        <div className="relative z-10">
          <BrandWordmark size="lg" src={logoUrl} />
        </div>

        {/* Tagline + meta */}
        <div className="relative z-10 flex flex-col gap-6">
          <h2 className="font-display text-[3.5rem] leading-[0.95] tracking-tight text-[var(--color-fg)]">
            Operación
            <br />
            <span className="text-[var(--color-accent-text)]">controlada.</span>
          </h2>
          <p className="text-sm text-[var(--color-fg-muted)] max-w-md leading-relaxed">
            Panel de gestión multi-tenant. Wallet, antifraude, bonos,
            sorteos y reportes en una sola consola operativa.
          </p>

          {/* Detalle decorativo: stat estilo terminal */}
          <div className="flex items-center gap-6 mt-4 pt-6 border-t border-[var(--color-border)] max-w-md">
            <TerminalStat label="Latencia" value="< 12ms" />
            <TerminalStat label="Tenants" value="∞" />
            <TerminalStat label="Uptime" value="99.97%" accent />
          </div>
        </div>

        {/* Footer */}
        <div className="relative z-10 flex items-center justify-between text-[11px] text-[var(--color-fg-subtle)]">
          <span className="font-mono">v0.1.0 · build {new Date().getFullYear()}</span>
          <span className="uppercase tracking-[0.12em]">Acceso restringido</span>
        </div>
      </aside>

      {/* ── Panel derecho: form ────────────────────────────── */}
      <main className="flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-sm animate-fade-up">{children}</div>
      </main>
    </div>
  );
}

function TerminalStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)]">
        {label}
      </span>
      <span
        className={`font-mono text-sm tabular-nums ${
          accent ? 'text-[var(--color-accent-text)]' : 'text-[var(--color-fg)]'
        }`}
      >
        {value}
      </span>
    </div>
  );
}
