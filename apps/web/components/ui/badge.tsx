/**
 * Badge â€” chip pequeÃ±o para status, tags, counters.
 *
 * Variants:
 *   - neutral: borde gris, texto muted (default).
 *   - success: verde sobrio.
 *   - warning: naranja sobrio.
 *   - danger: rojo (accent del DS).
 *   - info: cian, raro.
 *
 * TamaÃ±o Ãºnico â€” 18px alto. Caps + tracking ancho + monospace digit
 * (si hay nÃºmeros).
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
    'text-[var(--color-accent-text)] border-[var(--color-accent-border)] bg-[var(--color-accent-subtle)]',
  info: 'text-[#67e8f9] border-[#0e7490] bg-[#082f49]',
};

const DOT_COLORS: Record<BadgeVariant, string> = {
  neutral: 'bg-[var(--color-fg-subtle)]',
  success: 'bg-[var(--color-success)]',
  warning: 'bg-[var(--color-warning)]',
  danger: 'bg-[var(--color-accent)]',
  info: 'bg-[#06b6d4]',
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
        'inline-flex items-center gap-1.5 px-1.5 h-[18px]',
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
