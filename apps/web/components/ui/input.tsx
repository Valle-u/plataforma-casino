/**
 * Input — primitivo del design system.
 *
 * Fondo subtle (no transparente — separa visualmente de cards),
 * borde 1px gris. Focus state: borde rojo + shadow rojo MUY sutil.
 * Texto en font-mono para campos numéricos (montos), `data-numeric`.
 */

'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Si true, usa font-mono + tabular-nums. Para inputs de monto/ID. */
  numeric?: boolean;
  /** Marca el campo en estado error sin necesidad de aria-invalid. */
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, numeric, invalid, ...props }, ref) => {
    return (
      <input
        ref={ref}
        data-numeric={numeric ? '' : undefined}
        aria-invalid={invalid || props['aria-invalid']}
        className={cn(
          // 44px en mobile (minimo tactil), 36px desde `lg` para no perder
          // densidad en las pantallas de data del panel.
          'flex h-11 lg:h-9 w-full px-3 py-1.5 rounded-[var(--radius-sm)]',
          'bg-[var(--color-bg-subtle)] text-[var(--color-fg)]',
          'border border-[var(--color-border)]',
          'placeholder:text-[var(--color-fg-subtle)]',
          // Mobile-first: 16px evita el auto-zoom de iOS al enfocar
          // (inputs < 16px disparan zoom y el modal se descoloca).
          'text-base sm:text-[13px] leading-none',
          'transition-[border-color,box-shadow] duration-150',
          'hover:border-[var(--color-border-strong)]',
          'focus:outline-none focus:border-[var(--color-accent)]',
          'focus:shadow-[0_0_0_3px_var(--color-accent-glow)]',
          'disabled:cursor-not-allowed disabled:opacity-40',
          'aria-invalid:border-[var(--color-danger)]',
          'aria-invalid:shadow-[0_0_0_3px_rgba(242,85,90,0.22)]',
          'data-numeric:font-mono data-numeric:tabular-nums',
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';
