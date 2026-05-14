/**
 * EmptyState — "no hay nada que mostrar" con vibe terminal.
 *
 * Pattern: border dashed + ASCII art chico + texto caps. Reusable
 * en cualquier list/feed/grid vacío. Pasa el `query` opcional para
 * decorar el "stream" del header (e.g. "audit_log:tenant:jest").
 */

import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface EmptyStateProps {
  /** Línea principal que se muestra como `> waiting for {hint} ...` */
  hint?: string;
  /** Etiqueta debajo del bloque ascii. */
  label?: string;
  /** Stream del header (opcional). */
  stream?: string;
  /** Acción opcional al pie (e.g. botón "Crear primer X"). */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  hint = 'data',
  label = 'Sin resultados para mostrar',
  stream,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'border border-dashed border-[var(--color-border-strong)]',
        'p-8 flex flex-col items-center justify-center gap-3',
        'min-h-[200px]',
        className,
      )}
    >
      <div className="font-mono text-[var(--color-fg-subtle)] text-xs whitespace-pre-line text-center leading-relaxed">
        {`> waiting for ${hint} ...`}
        {stream && `\n> stream: ${stream}`}
        {`\n> ────────────────────────────`}
      </div>
      <span className="text-[11px] text-[var(--color-fg-subtle)] uppercase tracking-[0.1em] mt-2">
        {label}
      </span>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
