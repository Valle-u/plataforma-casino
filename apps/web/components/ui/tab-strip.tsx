/**
 * TabStrip — fila de tabs/filtros que scrollea en horizontal cuando no entra.
 *
 * Problema que resuelve: el panel usaba `overflow-x-auto hide-scrollbar`
 * suelto en cada página. En mobile eso deja los tabs cortados **sin ninguna
 * pista visual** de que hay más a la derecha (la scrollbar está oculta por
 * diseño y iOS/Android solo la muestran mientras se scrollea). Ej. medido en
 * 375px: la fila de Retiros necesita 573px en un contenedor de 341px, así que
 * "Rechazados/fallidos" y "Todos" quedaban enteramente fuera de pantalla.
 *
 * Solución: mismo scroll, pero con un degradé en el borde que aparece solo
 * del lado donde efectivamente queda contenido oculto. Es la señal estándar
 * de "hay más acá" y no ocupa layout (va absolute + pointer-events-none).
 *
 * Variants:
 *   - boxed: fila con borde y fondo, separadores por `gap-px` (default).
 *   - bare:  sin caja, para tabs que ya traen su propio `border-b`.
 *
 * Los tabs en sí los provee el caller como children — este componente solo
 * aporta el contenedor scrolleable y el affordance.
 */

'use client';

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

export type TabStripVariant = 'boxed' | 'bare';

interface TabStripProps {
  children: ReactNode;
  variant?: TabStripVariant;
  /** Clases extra del wrapper externo (ej. `sm:self-start`). */
  className?: string;
  /** Clases extra de la fila scrolleable. */
  rowClassName?: string;
  /** Label accesible de la fila (ej. "Filtros de retiros"). */
  label?: string;
}

const ROW_VARIANTS: Record<TabStripVariant, string> = {
  boxed:
    'flex items-center gap-px bg-[var(--color-border)] border border-[var(--color-border)] rounded-[var(--radius-sm)]',
  bare: 'flex gap-1 border-b border-[var(--color-border)]',
};

/**
 * De qué color arranca el degradé. Tiene que matchear el fondo de lo que se
 * está tapando: en `boxed` los tabs inactivos son `bg-elevated`; en `bare`
 * el fondo es el de la página.
 */
const FADE_FROM: Record<TabStripVariant, string> = {
  boxed: 'from-[var(--color-bg-elevated)]',
  bare: 'from-[var(--color-bg)]',
};

export function TabStrip({
  children,
  variant = 'boxed',
  className,
  rowClassName,
  label,
}: TabStripProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<{ start: boolean; end: boolean }>({
    start: false,
    end: false,
  });

  const sync = useCallback((): void => {
    const el = rowRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    // 1px de tolerancia: los anchos fraccionarios harían titilar el degradé.
    setEdges({ start: el.scrollLeft > 1, end: el.scrollLeft < max - 1 });
  }, []);

  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    sync();
    // Observamos la fila (cambia el clientWidth al rotar el device) y también
    // los hijos, porque los labels crecen cuando llega un contador nuevo.
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [sync, children]);

  return (
    <div className={cn('relative max-w-full min-w-0', className)}>
      <div
        ref={rowRef}
        onScroll={sync}
        role={label ? 'group' : undefined}
        aria-label={label}
        className={cn(
          ROW_VARIANTS[variant],
          'overflow-x-auto hide-scrollbar scroll-smooth overscroll-x-contain',
          rowClassName,
        )}
      >
        {children}
      </div>

      {edges.start && (
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-y-0 left-0 w-8',
            'bg-gradient-to-r to-transparent',
            FADE_FROM[variant],
          )}
        />
      )}
      {edges.end && (
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-y-0 right-0 w-8',
            'bg-gradient-to-l to-transparent',
            FADE_FROM[variant],
          )}
        />
      )}
    </div>
  );
}
