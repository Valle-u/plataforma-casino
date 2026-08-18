/**
 * CollapsibleCard — card colapsable reutilizable (mismo patrón visual que
 * NetworkCard). Header con título + icono opcional + slot `right`, y cuerpo
 * plegable. `defaultOpen` controla el estado inicial.
 */

'use client';

import { ChevronDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function CollapsibleCard({
  title,
  icon,
  defaultOpen = true,
  right,
  bodyClassName,
  children,
}: {
  title: string;
  icon?: ReactNode;
  defaultOpen?: boolean;
  right?: ReactNode;
  bodyClassName?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border border-[var(--color-border)] bg-[var(--color-bg-elevated)] rounded-[var(--radius)] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-[var(--color-bg-subtle)] transition-colors"
      >
        <span className="flex items-center gap-2">
          {icon && (
            <span className="text-[var(--color-fg-muted)] flex items-center">
              {icon}
            </span>
          )}
          <span className="font-medium text-[15px]">{title}</span>
        </span>
        <span className="flex items-center gap-3">
          {right}
          <ChevronDown
            className={cn(
              'size-4 text-[var(--color-fg-muted)] transition-transform',
              open && 'rotate-180',
            )}
          />
        </span>
      </button>
      {open && (
        <div
          className={cn(
            'border-t border-[var(--color-border)] p-4',
            bodyClassName,
          )}
        >
          {children}
        </div>
      )}
    </section>
  );
}
