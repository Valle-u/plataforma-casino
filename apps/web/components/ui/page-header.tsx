/**
 * PageHeader — encabezado estándar de TODA página del panel admin.
 *
 * Rediseño 2026-08-16 ("paz visual"): mismo layout en todas las secciones —
 * icono + título en criollo + una línea que explica para qué sirve, con un
 * slot de acciones a la derecha. Reemplaza los headers hechos a mano (que
 * derivaban: "Operación" vs "Operativa", títulos en inglés, etc.).
 */
import { type ComponentType, type ReactNode, type SVGProps } from 'react';

interface PageHeaderProps {
  /** Icono de la sección (mismo que en la sidebar, para reconocimiento). */
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  /** Título en criollo. */
  title: string;
  /** Una línea corta: para qué sirve la sección. */
  description?: ReactNode;
  /** Botones/acciones a la derecha. */
  actions?: ReactNode;
}

export function PageHeader({ icon: Icon, title, description, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
      <div className="flex items-start gap-3 min-w-0">
        {Icon && (
          <span className="mt-0.5 shrink-0 flex items-center justify-center size-10 border border-[var(--color-border)] bg-[var(--color-bg-subtle)] text-[var(--color-accent-text)]">
            <Icon className="size-5" />
          </span>
        )}
        <div className="flex flex-col gap-1 min-w-0">
          <h1 className="font-display text-2xl lg:text-3xl leading-tight tracking-tight">
            {title}
          </h1>
          {description && (
            <p className="text-sm text-[var(--color-fg-muted)] max-w-2xl">
              {description}
            </p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>
      )}
    </header>
  );
}
