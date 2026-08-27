/**
 * Button — primitivo del design system.
 *
 * Variants "clásicas" (admin, esquinas suaves):
 *   - primary: fondo acento (color de marca del tenant), texto por contraste.
 *   - secondary: borde gris, hover bg-subtle. Acciones secundarias.
 *   - ghost: sin borde, hover bg-subtle. Para nav y menúes.
 *   - danger: rojo destructivo (--color-danger), texto claro.
 *   - outline-accent: borde acento, hover rellena. Confirmaciones.
 *
 * Variants "premium" (Sprint 51.33 — player-facing aesthetic):
 *   - premium: gradient depth + glow + inner highlight. Equivalente a
 *     usar la utility `.btn-premium-primary` del DS.
 *   - premium-ghost: glass + edge highlight + glow on hover. Equivalente
 *     a `.btn-premium-secondary`.
 *
 *   Usá las premium en /play. Las clásicas siguen en /admin.
 *
 * Sizes (mobile → desktop desde `lg`): sm (36 → 28px), md (44 → 32px),
 * lg (44 → 40px), xl (44px fijo), icon (44 → 32px).
 */

'use client';

import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap',
    'rounded-[var(--radius-sm)]',
    'font-medium tracking-tight',
    'transition-[background-color,border-color,transform,box-shadow] duration-150',
    'active:scale-[0.985]',
    'disabled:pointer-events-none disabled:opacity-40',
    'select-none',
    '[&_svg]:size-4 [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary: [
          'bg-[var(--color-accent)] text-[var(--color-accent-fg)]',
          'hover:bg-[var(--color-accent-hover)]',
          'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]',
        ],
        secondary: [
          'bg-[var(--color-bg-subtle)] text-[var(--color-fg)]',
          'border border-[var(--color-border)]',
          'hover:bg-[var(--color-bg-hover)] hover:border-[var(--color-border-strong)]',
        ],
        ghost: [
          'bg-transparent text-[var(--color-fg-muted)]',
          'hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]',
        ],
        danger: [
          'bg-[var(--color-danger)] text-white',
          'hover:brightness-110',
        ],
        // Contorno rojo tenue (handoff): destructiva secundaria (ej.
        // "Bloquear" en un header). Rellena en rojo sólido al hover.
        'danger-outline': [
          'bg-[var(--color-danger-bg)] text-[var(--color-danger)]',
          'border border-[var(--color-danger)]/35',
          'hover:bg-[var(--color-danger)] hover:text-white hover:border-[var(--color-danger)]',
        ],
        'outline-accent': [
          'bg-transparent text-[var(--color-accent-text)]',
          'border border-[var(--color-accent-border)]',
          'hover:bg-[var(--color-accent)] hover:text-[var(--color-accent-fg)]',
          'hover:border-[var(--color-accent)]',
        ],
        // Sprint 51.33 — premium player-facing variants. Hacen el lookup
        // de las utility classes del DS (definidas en globals.css).
        premium: ['btn-premium-primary', 'rounded-[var(--radius)]'],
        'premium-ghost': ['btn-premium-secondary', 'rounded-[var(--radius)]'],
      },
      size: {
        // Alturas con piso táctil en mobile y densidad de data en desktop
        // (mismo idioma `h-N lg:h-N` que ya usaban bank-transactions y users).
        // `md` es la talla de acción principal → 44px, el mínimo de Apple HIG.
        // `sm` se queda en 36px: vive en contextos densos (filas de tabla,
        // acciones de card) donde 44px rompe el layout.
        sm: 'h-9 lg:h-7 px-2.5 text-xs gap-1.5 [&_svg]:size-3.5',
        md: 'h-11 lg:h-8 px-3 text-[13px]',
        lg: 'h-11 lg:h-10 px-4 text-sm',
        // Sprint 51.36: xl para CTAs grandes en /play (h-11, touch
        // target generoso a11y mobile).
        xl: 'h-11 px-5 text-sm',
        icon: 'size-11 lg:size-8 p-0',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };
