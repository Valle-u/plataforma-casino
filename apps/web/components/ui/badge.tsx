/**
 * Badge — chip pequeño para status, tags, counters.
 *
 * Variants:
 *   - neutral: borde gris, texto muted (default).
 *   - success: verde sobrio.
 *   - warning: naranja sobrio.
 *   - danger: rojo (accent del DS).
 *   - info: cian, raro.
 *
 * Tamaño único — 18px alto. Caps + tracking ancho + monospace digit
 * (si hay números).
 */

import { type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type BadgeVariant = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  /** Dot indicador a la izquierda (estilo status). */
  dot?: boolean;
}

const VARIANTS: Record<BadgeVariant, string> = {
  neutral:
    'text-[var(--color-fg-muted)] border-[var(--color-border)] bg-[var(--color-bg-subtle)]',
  success:
    'text-[var(--color-success)] border-[var(--color-success)] bg-[var(--color-success-bg)]',
  warning:
    'text-[var(--color-warning)] border-[var(--color-warning)] bg-[var(--color-warning-bg)]',
  danger:
    'text-[var(--color-danger)] border-[var(--color-danger)] bg-[var(--color-danger-bg)]',
  info: 'text-[var(--color-info)] border-[var(--color-info)] bg-[var(--color-info-bg)]',
};

const DOT_COLORS: Record<BadgeVariant, string> = {
  neutral: 'bg-[var(--color-fg-subtle)]',
  success: 'bg-[var(--color-success)]',
  warning: 'bg-[var(--color-warning)]',
  danger: 'bg-[var(--color-danger)]',
  info: 'bg-[var(--color-info)]',
};

export function Badge({
  variant = 'neutral',
  dot = false,
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-1.5 h-[18px] rounded-md',
        'text-[10px] uppercase tracking-[0.1em] font-medium',
        'border tabular-nums',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {dot && <span className={cn('size-1.5 rounded-full', DOT_COLORS[variant])} />}
      {children}
    </span>
  );
}
