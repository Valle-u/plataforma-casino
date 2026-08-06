/**
 * Select — `<select>` nativo estilizado.
 *
 * Razón vs Radix Select: para 5-10 opciones simples sin búsqueda, el
 * `<select>` nativo es accesible por default, no infla el bundle, y se
 * comporta correcto en mobile (UI nativa del SO). Para multi-select o
 * search, se cambia por Radix.
 *
 * Estética: matchea Input. Chevron custom (lucide) overlay para evitar
 * el dropdown nativo del browser que rompe el DS.
 */

'use client';

import { ChevronDown } from 'lucide-react';
import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, invalid, children, ...props }, ref) => {
    return (
      <div className="relative">
        <select
          ref={ref}
          aria-invalid={invalid || props['aria-invalid']}
          className={cn(
            'appearance-none w-full h-9 pl-3 pr-9',
            'bg-[var(--color-bg-subtle)] text-[var(--color-fg)]',
            'border border-[var(--color-border)]',
            // Mobile-first: 16px evita el auto-zoom de iOS al enfocar.
            'text-base sm:text-[13px] leading-none',
            'transition-[border-color,box-shadow] duration-150',
            'hover:border-[var(--color-border-strong)]',
            'focus:outline-none focus:border-[var(--color-accent)]',
            'focus:shadow-[0_0_0_3px_var(--color-accent-glow)]',
            'disabled:cursor-not-allowed disabled:opacity-40',
            'aria-invalid:border-[var(--color-accent)]',
            'aria-invalid:shadow-[0_0_0_3px_var(--color-accent-glow)]',
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden
          className="size-3.5 absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-subtle)] pointer-events-none"
        />
      </div>
    );
  },
);
Select.displayName = 'Select';
