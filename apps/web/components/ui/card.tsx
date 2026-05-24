/**
 * Card — contenedor base de paneles. Bg elevated + borde 1px.
 *
 * Variants (Sprint 51.33):
 *   - default (sin variant): admin terminal look — sharp corners.
 *   - premium: glass + edge highlight + sombra layered + corners suaves
 *     (.card-premium del DS). Usar en /play.
 *   - premium-hover: agrega hover lift + accent border. Usar para tiles
 *     clickable en /play.
 *
 * Props legacy:
 *   - `rounded`: alias compat — equivalente a override con className.
 *     En "default" agrega rounded-sm; en premium ya está cubierto.
 */

import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  rounded?: boolean;
  variant?: 'default' | 'premium' | 'premium-hover';
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, rounded, variant = 'default', ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        variant === 'default' && [
          'bg-[var(--color-bg-elevated)] border border-[var(--color-border)]',
          rounded && 'rounded-[var(--radius)]',
        ],
        variant === 'premium' && [
          'card-premium rounded-[var(--radius-lg)]',
        ],
        variant === 'premium-hover' && [
          'card-premium card-premium-hover rounded-[var(--radius-lg)]',
        ],
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
