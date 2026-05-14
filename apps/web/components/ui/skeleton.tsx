/**
 * Skeleton — placeholder con shimmer animado para loading states.
 * Definido en globals.css (`animate-shimmer`). Esquinas duras.
 */

import { type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn('animate-shimmer', className)}
      {...rest}
    />
  );
}
