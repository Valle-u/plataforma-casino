/**
 * FormField â€” wrapper consistente para todos los forms.
 *
 * Estructura: label arriba (caps tracking ancho) â†’ control (input/select)
 * â†’ error opcional debajo (rojo, 12px) â†’ hint opcional (subtle).
 *
 * Pasamos `id` para wirear `<label htmlFor>` correctamente. Si no se pasa,
 * generamos uno con un counter â€” peligroso para SSR, asÃ­ que mejor pasar
 * siempre `id` explÃ­cito.
 */

import { type ReactNode } from 'react';
import { Label } from './label';

interface FormFieldProps {
  id: string;
  label: string;
  /** Texto de ayuda debajo (tono muted). */
  hint?: string;
  /** Mensaje de error (pinta rojo + se anuncia a screen readers). */
  error?: string;
  /** Marca el campo como requerido visualmente (con asterisco rojo). */
  required?: boolean;
  children: ReactNode;
}

export function FormField({
  id,
  label,
  hint,
  error,
  required,
  children,
}: FormFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="flex items-center gap-1">
        {label}
        {required && (
          <span className="text-[var(--color-accent-text)]" aria-hidden>
            *
          </span>
        )}
      </Label>
      {children}
      {error ? (
        <span
          role="alert"
          className="text-[11px] text-[var(--color-accent-text)]"
        >
          {error}
        </span>
      ) : hint ? (
        <span className="text-[11px] text-[var(--color-fg-subtle)]">
          {hint}
        </span>
      ) : null}
    </div>
  );
}
