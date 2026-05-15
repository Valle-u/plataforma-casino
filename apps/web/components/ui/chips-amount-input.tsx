/**
 * ChipsAmountInput — input especializado para montos en CHIPS.
 *
 * Características:
 *   - Font mono + tabular-nums para alinear dígitos.
 *   - Sufijo "CHIPS" caps tracking ancho a la derecha.
 *   - Valida que solo se ingresen dígitos + 1 punto + max 2 decimales (regex).
 *   - Tamaño grande (h-12) para destacar visualmente como input crítico.
 *
 * Para inputs de monto chicos en tablas o forms compactos, usar `Input`
 * normal con prop `numeric`.
 */

'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

interface ChipsAmountInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  invalid?: boolean;
  /** Override del sufijo. Default "CHIPS". */
  suffix?: string;
}

const AMOUNT_REGEX = /^\d{0,12}(\.\d{0,2})?$/;

export const ChipsAmountInput = forwardRef<HTMLInputElement, ChipsAmountInputProps>(
  ({ className, invalid, suffix = 'CHIPS', onChange, ...props }, ref) => {
    return (
      <div className="relative">
        <input
          ref={ref}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          aria-invalid={invalid || props['aria-invalid']}
          onChange={(e) => {
            // Bloquea inputs inválidos sin perder el cursor.
            const value = e.target.value;
            if (value === '' || AMOUNT_REGEX.test(value)) {
              onChange?.(e);
            }
          }}
          className={cn(
            'flex h-12 w-full pl-3 pr-20 py-2',
            'bg-[var(--color-bg-subtle)] text-[var(--color-fg)]',
            'border border-[var(--color-border)]',
            'placeholder:text-[var(--color-fg-subtle)]',
            'font-mono tabular-nums text-xl tracking-tight',
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
        />
        <span
          aria-hidden
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)] font-sans pointer-events-none"
        >
          {suffix}
        </span>
      </div>
    );
  },
);
ChipsAmountInput.displayName = 'ChipsAmountInput';
