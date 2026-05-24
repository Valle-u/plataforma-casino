/**
 * Switch — primitivo toggle on/off del design system (Sprint 51.33).
 *
 * Antes esta lógica vivía inline en /play/settings (ToggleRow). Extraído
 * para reuso en futuras pantallas de preferencias.
 *
 * Composición:
 *   - <Switch> solo: el control bool, con label + hint opcional.
 *   - <SwitchRow>: container que mete label + hint a la izquierda + switch
 *     a la derecha, pensado para listas verticales de toggles.
 *
 * A11y: usa role="switch", aria-checked, foco accesible (focus-visible),
 * ENTER/SPACE para toggle.
 */

'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface SwitchProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean;
  onChange: (next: boolean) => void;
}

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(
  ({ className, checked, onChange, disabled, ...rest }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={cn(
          'relative shrink-0 inline-flex items-center h-6 w-11 rounded-full',
          'transition-colors duration-200',
          'border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/40',
          checked
            ? 'bg-[var(--color-accent)] border-[var(--color-accent)]'
            : 'bg-[var(--color-bg-subtle)] border-[var(--color-border-strong)]',
          disabled && 'opacity-50 cursor-not-allowed',
          className,
        )}
        {...rest}
      >
        <span
          aria-hidden
          className={cn(
            'inline-block size-4 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.4)]',
            'transition-transform duration-200',
            checked ? 'translate-x-[1.4rem]' : 'translate-x-[0.15rem]',
          )}
        />
      </button>
    );
  },
);
Switch.displayName = 'Switch';

/**
 * SwitchRow — wrapper con label + hint + switch alineados.
 *
 * Uso:
 *   <SwitchRow
 *     label="Sonidos"
 *     hint="Beeps sintéticos al ganar."
 *     checked={enabled}
 *     onChange={setEnabled}
 *   />
 */
export function SwitchRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4',
        disabled && 'opacity-60',
      )}
    >
      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
        <span className="text-[13px] font-medium text-[var(--color-fg)]">
          {label}
        </span>
        {hint && (
          <p className="text-[11px] text-[var(--color-fg-muted)] leading-snug">
            {hint}
          </p>
        )}
      </div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}
