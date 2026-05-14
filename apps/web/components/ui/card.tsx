/**
 * Card — contenedor base de paneles. Bg elevated + borde 1px.
 * Sin radius por default (esquinas duras — brutalist touch). Use
 * `rounded` prop si querés esquinas redondeadas.
 */

import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  rounded?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, rounded, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'bg-[var(--color-bg-elevated)] border border-[var(--color-border)]',
        rounded && 'rounded-[var(--radius)]',
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex items-center justify-between gap-2',
        'px-4 py-3 border-b border-[var(--color-border)]',
        className,
      )}
      {...props}
    />
  ),
);
CardHeader.displayName = 'CardHeader';

export const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn(
        'text-[11px] uppercase tracking-[0.1em] font-medium',
        'text-[var(--color-fg-muted)]',
        'font-sans',
        className,
      )}
      {...props}
    />
  ),
);
CardTitle.displayName = 'CardTitle';

export const CardBody = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-4', className)} {...props} />
  ),
);
CardBody.displayName = 'CardBody';
