/**
 * KpiTile — tile de KPI del panel (rediseño 2026-08 · handoff).
 *
 * Etiqueta en caps + ícono a la derecha, valor grande (Outfit) con color
 * semántico opcional, y un hint abajo. Tarjeta redondeada con borde propio.
 *
 * `tone` colorea el VALOR según el significado ("un color = una acción"):
 *   success (entra plata) · danger (sale) · warning (atención) · info (netwin)
 *   · accent (color de marca) · default (neutro).
 */

import { type ComponentType, type ReactNode, type SVGProps } from 'react';
import { cn } from '@/lib/cn';

export type KpiTone =
  | 'default'
  | 'success'
  | 'danger'
  | 'warning'
  | 'info'
  | 'accent';

const TONE_CLASS: Record<KpiTone, string> = {
  default: 'text-[var(--color-fg)]',
  success: 'text-[var(--color-success)]',
  danger: 'text-[var(--color-danger)]',
  warning: 'text-[var(--color-warning)]',
  info: 'text-[var(--color-info)]',
  accent: 'text-[var(--color-accent-text)]',
};

interface KpiTileProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  tone?: KpiTone;
  className?: string;
}

export function KpiTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'default',
  className,
}: KpiTileProps) {
  return (
    <div
      className={cn(
        'bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius)]',
        'p-4 flex flex-col gap-2',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-medium">
          {label}
        </span>
        {Icon && (
          <Icon className="size-4 shrink-0 text-[var(--color-fg-subtle)]" />
        )}
      </div>
      <span
        className={cn(
          'font-display text-2xl leading-none tracking-tight tabular-nums',
          TONE_CLASS[tone],
        )}
      >
        {value}
      </span>
      {hint && (
        <span className="text-[11px] text-[var(--color-fg-subtle)]">{hint}</span>
      )}
    </div>
  );
}
