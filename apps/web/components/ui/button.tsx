/**
 * Button — primitivo del design system.
 *
 * Variants:
 *   - primary: fondo rojo, texto claro. CTA principal del flow.
 *   - secondary: borde gris, hover bg-subtle. Acciones secundarias.
 *   - ghost: sin borde, hover bg-subtle. Para nav y menúes.
 *   - danger: alias de primary — el rojo ya es el destructivo del DS.
 *   - outline-accent: borde rojo, hover rellena. Confirmaciones críticas.
 *
 * Sizes: sm (28px), md (32px), lg (40px).
 *
 * Sin sombras blandas. Estados via background + border shifts. Hover
 * usa scale(0.985) sutil para microfeedback sin ser ridículo.
 */

'use client';

import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap',
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
          'bg-[var(--color-accent)] text-[var(--color-accent-fg)]',
          'hover:bg-[var(--color-accent-hover)]',
        ],
        'outline-accent': [
          'bg-transparent text-[var(--color-accent)]',
          'border border-[var(--color-accent-border)]',
          'hover:bg-[var(--color-accent)] hover:text-[var(--color-accent-fg)]',
          'hover:border-[var(--color-accent)]',
        ],
      },
      size: {
        sm: 'h-7 px-2.5 text-xs gap-1.5 [&_svg]:size-3.5',
        md: 'h-8 px-3 text-[13px]',
        lg: 'h-10 px-4 text-sm',
        icon: 'h-8 w-8 p-0',
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
