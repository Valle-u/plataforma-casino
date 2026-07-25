/**
 * LoadingOverlay — overlay de carga para áreas de contenido.
 *
 * Se superpone al contenido existente con un fondo semi-transparente
 * y un spinner centrado. Mantiente el espacio del contenido padre
 * para evitar layout shift.
 *
 * Uso:
 *   <div className="relative">
 *     {isLoading && <LoadingOverlay />}
 *     <Contenido />
 *   </div>
 */

import { cn } from '@/lib/cn';
import { Spinner } from './spinner';

export function LoadingOverlay({
  className,
  label = 'Cargando…',
}: {
  className?: string;
  label?: string;
}) {
  return (
    <div
      className={cn(
        'absolute inset-0 z-40 flex items-center justify-center',
        'bg-[var(--color-bg)]/80 backdrop-blur-[1px]',
        'transition-opacity duration-200',
        className,
      )}
      role="status"
      aria-label={label}
    >
      <div className="flex flex-col items-center gap-2">
        <Spinner size="md" className="text-[var(--color-fg-muted)]" />
        <span className="text-[11px] text-[var(--color-fg-subtle)] uppercase tracking-[0.08em]">
          {label}
        </span>
      </div>
    </div>
  );
}

/**
 * ContentLoader — wrapper completo con skeleton o spinner.
 * Útil para secciones que cambian de contenido al filtrar.
 */
export function ContentLoader({
  isLoading,
  isFetching,
  children,
  className,
}: {
  isLoading: boolean;
  isFetching?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const showOverlay = isLoading || (isFetching && !isLoading);

  return (
    <div className={cn('relative', className)}>
      {showOverlay && (
        <LoadingOverlay label={isLoading ? 'Cargando…' : 'Actualizando…'} />
      )}
      <div className={cn(isLoading && 'pointer-events-none')}>
        {children}
      </div>
    </div>
  );
}
