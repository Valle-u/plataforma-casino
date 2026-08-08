/**
 * EmptyState — "acá no hay nada todavía" con mensaje amigable.
 *
 * Mensaje corto en español, simple y sin tecnicismos, con ícono suave y
 * una acción opcional que invita al usuario a seguir (ej. "Solicitar el
 * primero"). Reusable en cualquier list/feed/grid vacío (player y admin).
 *
 * Los props `hint` y `stream` se mantienen solo por compatibilidad con
 * call sites viejos; ya NO se renderizan (antes mostraron texto de
 * terminal tipo `> waiting for data ...`).
 */

import { type ReactNode } from 'react';
import { Inbox } from 'lucide-react';
import { cn } from '@/lib/cn';

interface EmptyStateProps {
  /** Deprecated — se ignora (compatibilidad). */
  hint?: string;
  /** Deprecated — se ignora (compatibilidad). */
  stream?: string;
  /** Mensaje principal, corto y amigable. */
  label?: string;
  /** Sub-mensaje opcional, más explicativo (invita a la acción). */
  description?: string;
  /** Acción opcional al pie (e.g. botón "Solicitar el primero"). */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  label = 'Todavía no hay nada para mostrar acá',
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border-strong)] p-8 text-center',
        className,
      )}
    >
      <span className="grid size-12 shrink-0 place-items-center rounded-full bg-[var(--color-bg-subtle)] text-[var(--color-fg-subtle)]">
        <Inbox className="size-6" strokeWidth={1.5} />
      </span>
      <span className="max-w-[340px] text-[14px] font-medium leading-snug text-[var(--color-fg)]">
        {label}
      </span>
      {description && (
        <span className="max-w-[340px] text-[12px] leading-relaxed text-[var(--color-fg-muted)]">
          {description}
        </span>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
