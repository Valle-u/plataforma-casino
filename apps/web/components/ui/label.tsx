/**
 * Label — wrapping Radix Label con estilo propio.
 * Caja chica encima del input. Caps + tracking ancho para diferenciar
 * visualmente del valor (estilo terminal/forensics).
 */

'use client';

import * as LabelPrimitive from '@radix-ui/react-label';
import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/cn';

export const Label = forwardRef<
  HTMLLabelElement,
  ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      'text-[11px] uppercase tracking-[0.08em] font-medium',
      'text-[var(--color-fg-muted)]',
      'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
Label.displayName = LabelPrimitive.Root.displayName;
