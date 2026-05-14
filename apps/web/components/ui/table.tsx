/**
 * Table primitives — densas, monospace numbers, hover-aware.
 *
 * Filosofía:
 *   - Sin radius (esquinas duras consistente con el DS).
 *   - Headers caps + tracking ancho + texto muted.
 *   - Rows: border-b 1px (sin zebra pesada — la separación viene del border).
 *   - Hover: bg-subtle + border-l-2 rojo invisible que se materializa.
 *   - Click anywhere row → cursor-pointer (cuando se usa con onClick).
 *   - Numeric cells: clase `num` (font-mono + tabular-nums + text-right).
 */

import { type HTMLAttributes, type TdHTMLAttributes, type ThHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export function Table({ className, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <table
        className={cn(
          'w-full text-[13px] border-separate border-spacing-0',
          className,
        )}
        {...rest}
      />
    </div>
  );
}

export function THead({ className, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn('bg-[var(--color-bg-subtle)] sticky top-0 z-10', className)}
      {...rest}
    />
  );
}

export function TBody({ className, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('', className)} {...rest} />;
}

export function TR({
  className,
  interactive,
  ...rest
}: HTMLAttributes<HTMLTableRowElement> & { interactive?: boolean }) {
  return (
    <tr
      className={cn(
        'group',
        interactive &&
          'cursor-pointer hover:bg-[var(--color-bg-subtle)] transition-colors',
        className,
      )}
      {...rest}
    />
  );
}

export function TH({
  className,
  align,
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'text-[10px] uppercase tracking-[0.12em] font-medium',
        'text-[var(--color-fg-muted)]',
        'px-3 h-9 text-left',
        'border-b border-[var(--color-border-strong)]',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className,
      )}
      {...rest}
    />
  );
}

export function TD({
  className,
  align,
  numeric,
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      className={cn(
        'px-3 py-2 text-[13px]',
        'border-b border-[var(--color-border)]',
        'text-[var(--color-fg)]',
        numeric && 'font-mono tabular-nums text-right',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className,
      )}
      {...rest}
    />
  );
}
