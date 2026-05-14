/**
 * StatTile — tile de KPI para dashboard. Big number + label + delta opcional.
 * Tipografía: el value usa display font con tracking apretado y tamaño grande;
 * el label es una caja chica caps + tracking ancho.
 *
 * Variant `accent`: cambia el value a color rojo (para destacar críticos).
 */

import { type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface StatTileProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  value: ReactNode;
  unit?: string;
  /** Delta opcional (e.g. "+12.4%" o "-3"). Color decidido por signo. */
  delta?: string;
  /** Variante visual: 'accent' colorea el value en rojo. */
  variant?: 'default' | 'accent';
  hint?: string;
}

export function StatTile({
  label,
  value,
  unit,
  delta,
  variant = 'default',
  hint,
  className,
  ...rest
}: StatTileProps) {
  const isPositive = delta?.startsWith('+');
  const isNegative = delta?.startsWith('-');

  return (
    <div
      className={cn(
        'group relative',
        'bg-[var(--color-bg-elevated)] border border-[var(--color-border)]',
        'p-4 flex flex-col gap-3',
        'transition-colors duration-200',
        'hover:border-[var(--color-border-strong)]',
        className,
      )}
      {...rest}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-medium">
          {label}
        </span>
        {hint && (
          <span className="text-[10px] text-[var(--color-fg-subtle)] tabular-nums">
            {hint}
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-1.5">
        <span
          className={cn(
            'font-display text-[2rem] leading-none tracking-tight tabular-nums',
            variant === 'accent' ? 'text-[var(--color-accent)]' : 'text-[var(--color-fg)]',
          )}
        >
          {value}
        </span>
        {unit && (
          <span className="text-xs text-[var(--color-fg-subtle)] font-mono">
            {unit}
          </span>
        )}
      </div>

      {delta && (
        <div className="flex items-center gap-1">
          <span
            className={cn(
              'text-xs font-mono tabular-nums',
              isPositive && 'text-[var(--color-success)]',
              isNegative && 'text-[var(--color-accent)]',
              !isPositive && !isNegative && 'text-[var(--color-fg-muted)]',
            )}
          >
            {delta}
          </span>
          <span className="text-[10px] text-[var(--color-fg-subtle)] uppercase tracking-wider">
            vs ayer
          </span>
        </div>
      )}

      {/* Acento visual en hover: border-l rojo */}
      <div
        aria-hidden
        className="absolute left-0 top-0 bottom-0 w-px bg-[var(--color-accent)] opacity-0 group-hover:opacity-100 transition-opacity"
      />
    </div>
  );
}
