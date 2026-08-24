/**
 * PageShell — contenedor estándar de TODA página del panel admin.
 *
 * Rediseño 2026-08-16 ("paz visual"): unifica padding, ancho máximo y
 * espaciado vertical para que ninguna sección tenga márgenes distintos. Toda
 * página del panel debería envolver su contenido en <PageShell>.
 */
import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function PageShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // El padding horizontal lo pone `<main>` del layout admin; acá solo el
        // vertical, así no se duplica (32px por lado ahogaba las páginas en
        // mobile). Ver components/ui/page-shell + app/(admin)/layout.tsx.
        'py-4 sm:py-5 lg:py-6',
        'flex flex-col gap-5 max-w-[1600px] mx-auto',
        className,
      )}
    >
      {children}
    </div>
  );
}
