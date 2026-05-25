/**
 * /admin error boundary — Sprint 53.3.
 *
 * Captura errores que ocurren DENTRO de cualquier ruta admin (dashboard,
 * deposits, wallet, etc.) sin tirar el layout (sidebar + header siguen
 * visibles). El usuario ve un mensaje claro + opción de reintentar +
 * volver al dashboard.
 *
 * Diferente del global-error.tsx que reemplaza el layout entero —
 * éste vive DENTRO del AdminLayout.
 */

'use client';

import { AlertTriangle, ArrowLeft, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[AdminError]', error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4 sm:px-6 py-8 sm:py-12">
      <div className="w-full max-w-md flex flex-col gap-5">
        {/* Icon + kicker */}
        <div className="flex items-center gap-2">
          <AlertTriangle
            className="size-4 text-[var(--color-accent-text)]"
            aria-hidden
          />
          <span className="text-[11px] uppercase tracking-[0.14em] font-medium text-[var(--color-accent-text)]">
            Error en esta sección
          </span>
        </div>

        {/* Título */}
        <h1 className="font-display text-[2rem] leading-tight tracking-tight text-[var(--color-fg)]">
          Algo no cargó bien
        </h1>

        {/* Descripción */}
        <p className="text-[13px] text-[var(--color-fg-muted)] leading-relaxed">
          La página que intentabas ver tiró un error inesperado. El resto
          del panel sigue funcionando — podés volver al dashboard o
          reintentar acá.
        </p>

        {/* Error message (dev hint) — visible siempre porque es panel
           interno de operadores, no público */}
        {error.message && (
          <pre className="text-[11px] font-mono text-[var(--color-fg-subtle)] bg-[var(--color-bg-subtle)] border border-[var(--color-border)] p-3 overflow-x-auto whitespace-pre-wrap break-words">
            {error.message}
          </pre>
        )}

        {/* Digest para soporte */}
        {error.digest && (
          <div className="text-[11px] text-[var(--color-fg-subtle)] font-mono">
            ID para soporte:{' '}
            <span className="text-[var(--color-fg-muted)]">{error.digest}</span>
          </div>
        )}

        {/* Acciones */}
        <div className="flex items-center gap-2 flex-wrap pt-2">
          <Button variant="primary" size="md" onClick={() => reset()}>
            <RefreshCw className="size-3.5" />
            Reintentar
          </Button>
          <Button variant="secondary" size="md" asChild>
            <Link href="/dashboard">
              <ArrowLeft className="size-3.5" />
              Volver al dashboard
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
