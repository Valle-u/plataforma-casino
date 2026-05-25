/**
 * /play error boundary — Sprint 53.3.
 *
 * Captura errores en cualquier ruta del player (lobby, wallet, wheel,
 * etc.) sin tirar el chrome (header + footer + bottom nav siguen).
 *
 * UX premium consistente con el resto de /play: card-premium glass,
 * lenguaje cercano (no "error técnico XYZ"), CTAs accionables.
 */

'use client';

import { AlertTriangle, ArrowRight, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export default function PlayError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[PlayError]', error);
  }, [error]);

  return (
    <div className="max-w-[600px] mx-auto px-4 sm:px-6 py-12 sm:py-20">
      <div className="card-premium rounded-[var(--radius-xl)] p-6 sm:p-10 flex flex-col gap-5 relative overflow-hidden">
        {/* Glow accent radial sutil */}
        <div
          aria-hidden
          className="absolute -inset-x-12 -top-12 h-48 opacity-40 blur-3xl pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse at center, var(--color-accent-glow) 0%, transparent 65%)',
          }}
        />

        <div className="relative flex items-center gap-2">
          <AlertTriangle
            className="size-4 text-[var(--color-accent-text)]"
            aria-hidden
          />
          <span className="text-[11px] uppercase tracking-[0.14em] font-medium text-[var(--color-accent-text)]">
            Ups
          </span>
        </div>

        <h1 className="relative font-display text-2xl sm:text-[2.25rem] leading-tight tracking-tight text-[var(--color-fg)]">
          Esto no salió como esperábamos
        </h1>

        <p className="relative text-[13px] sm:text-sm text-[var(--color-fg-muted)] leading-relaxed">
          Hubo un problema cargando esta pantalla. Probá de nuevo en un
          segundo. Si se repite, andá al inicio y abrinos un ticket desde
          Mi cuenta — vamos a revisarlo.
        </p>

        {error.digest && (
          <div className="relative text-[11px] font-mono text-[var(--color-fg-subtle)] bg-[var(--color-bg-subtle)] border border-[var(--color-border)] px-3 py-2 rounded-[var(--radius-sm)]">
            Referencia:{' '}
            <span className="text-[var(--color-fg-muted)]">{error.digest}</span>
          </div>
        )}

        <div className="relative flex items-center gap-2 sm:gap-3 flex-wrap pt-2">
          <Button variant="premium" size="lg" onClick={() => reset()}>
            <RefreshCw className="size-3.5" />
            Reintentar
          </Button>
          <Button variant="premium-ghost" size="lg" asChild>
            <Link href="/play">
              Volver al inicio
              <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
