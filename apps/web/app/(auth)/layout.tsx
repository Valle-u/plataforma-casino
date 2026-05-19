/**
 * Auth layout â€” pantalla centrada con detalles visuales propios.
 *
 * ComposiciÃ³n:
 *   - Lado izquierdo: panel con brand mark + tagline + grid sutil.
 *   - Lado derecho: formulario centrado.
 *   - Mobile: stack vertical, brand colapsa a header.
 *
 * El panel izquierdo trae "personalidad" del DS sin distraer del form:
 *   - Brand mark angular con detalle rojo.
 *   - PatrÃ³n de fondo (lÃ­neas diagonales sutiles).
 *   - Tagline corto con tipografÃ­a display.
 */

import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      {/* â”€â”€ Panel izquierdo: brand / atmÃ³sfera â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <aside className="relative hidden lg:flex flex-col justify-between p-12 overflow-hidden border-r border-[var(--color-border)]">
        {/* PatrÃ³n de fondo: lÃ­neas diagonales sutiles */}
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
        <div className="relative z-10 flex items-center gap-3">
          <BrandMark />
          <div className="flex flex-col">
            <span className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-fg-muted)] font-medium">
              Plataforma
            </span>
            <span className="font-display text-2xl tracking-tight text-[var(--color-fg)] leading-none mt-0.5">
              Casino
            </span>
          </div>
        </div>

        {/* Tagline + meta */}
        <div className="relative z-10 flex flex-col gap-6">
          <h2 className="font-display text-[3.5rem] leading-[0.95] tracking-tight text-[var(--color-fg)]">
            OperaciÃ³n
            <br />
            <span className="text-[var(--color-accent-text)]">controlada.</span>
          </h2>
          <p className="text-sm text-[var(--color-fg-muted)] max-w-md leading-relaxed">
            Panel de gestiÃ³n multi-tenant. Wallet, antifraude, bonos,
            sorteos y reportes en una sola consola operativa.
          </p>

          {/* Detalle decorativo: stat estilo terminal */}
          <div className="flex items-center gap-6 mt-4 pt-6 border-t border-[var(--color-border)] max-w-md">
            <TerminalStat label="Latencia" value="< 12ms" />
            <TerminalStat label="Tenants" value="âˆž" />
            <TerminalStat label="Uptime" value="99.97%" accent />
          </div>
        </div>

        {/* Footer */}
        <div className="relative z-10 flex items-center justify-between text-[11px] text-[var(--color-fg-subtle)]">
          <span className="font-mono">v0.1.0 Â· build {new Date().getFullYear()}</span>
          <span className="uppercase tracking-[0.12em]">Acceso restringido</span>
        </div>
      </aside>

      {/* â”€â”€ Panel derecho: form â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <main className="flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-sm animate-fade-up">{children}</div>
      </main>
    </div>
  );
}

/** Marca angular: dos triÃ¡ngulos rojos formando un "C" estilizado. */
function BrandMark() {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 32 32"
      fill="none"
      aria-label="Logo"
      className="shrink-0"
    >
      <rect width="32" height="32" fill="var(--color-bg-elevated)" />
      <path d="M6 6 L26 6 L26 12 L12 12 L12 20 L26 20 L26 26 L6 26 Z" fill="var(--color-fg)" />
      <rect x="22" y="6" width="4" height="6" fill="var(--color-accent)" />
      <rect x="22" y="20" width="4" height="6" fill="var(--color-accent)" />
    </svg>
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
