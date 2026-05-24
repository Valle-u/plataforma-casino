/**
 * Skeleton — placeholder con shimmer animado para loading states.
 *
 * Sprint 51.25 update: corners suaves por default (matchea el premium
 * aesthetic). Si querés esquinas duras (admin terminal), override con
 * `rounded-none` en className.
 *
 * El gradient shimmer está definido en globals.css (`animate-shimmer`).
 */

import { type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn('animate-shimmer rounded-[var(--radius-sm)]', className)}
      {...rest}
    />
  );
}
