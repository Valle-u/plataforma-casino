/**
 * Spinner — indicator de carga inline monocromático.
 *
 * Usa --color-fg-muted para el ring, compatible con admin-neutral
 * y cualquier otro theme. Tamaños predefinidos: sm (16px), md (24px), lg (40px).
 */

import { cn } from '@/lib/cn';

type SpinnerSize = 'sm' | 'md' | 'lg';

const SIZE_MAP: Record<SpinnerSize, string> = {
  sm: 'size-4',
  md: 'size-6',
  lg: 'size-10',
};

export function Spinner({
  size = 'md',
  className,
}: {
  size?: SpinnerSize;
  className?: string;
}) {
  return (
    <svg
      className={cn('animate-spin', SIZE_MAP[size], className)}
      viewBox="0 0 24 24"
      fill="none"
      role="status"
      aria-label="Cargando…"
    >
      <circle
        className="opacity-20"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="opacity-90"
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
