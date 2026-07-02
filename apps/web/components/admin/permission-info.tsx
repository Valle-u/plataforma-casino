/**
 * Componentes de presentación de permisos para los flujos de otorgamiento.
 *
 *   - <RiskBadge>: pill con el nivel de riesgo (bajo / medio / alto).
 *   - <PermissionConsequenceCard>: tarjeta con nombre amigable + qué hace +
 *     "qué puede pasar si lo otorgás" + badge de riesgo. Es la "explicación
 *     previa" que ve el operador antes de dar un permiso.
 *
 * Toda la copy sale de `lib/permission-meta.ts` (fuente única).
 */

'use client';

import { Info, ShieldAlert, TriangleAlert } from 'lucide-react';
import {
  getPermissionMeta,
  RISK_LABELS,
  type PermissionRisk,
} from '@/lib/permission-meta';
import { cn } from '@/lib/cn';

/** Estilos por nivel de riesgo, alineados al design system. */
const RISK_STYLE: Record<
  PermissionRisk,
  { badge: string; dot: string; card: string; accentText: string; Icon: typeof Info }
> = {
  low: {
    badge:
      'border-[var(--color-border-strong)] text-[var(--color-fg-muted)] bg-[var(--color-bg-subtle)]',
    dot: 'bg-[var(--color-fg-subtle)]',
    card: 'border-[var(--color-border)] border-l-[var(--color-fg-subtle)] bg-[var(--color-bg)]',
    accentText: 'text-[var(--color-fg-muted)]',
    Icon: Info,
  },
  medium: {
    badge:
      'border-[var(--color-warning)] text-[var(--color-warning)] bg-[var(--color-warning-bg)]',
    dot: 'bg-[var(--color-warning)]',
    card: 'border-[var(--color-warning)] border-l-[var(--color-warning)] bg-[var(--color-warning-bg)]',
    accentText: 'text-[var(--color-warning)]',
    Icon: TriangleAlert,
  },
  high: {
    badge:
      'border-[var(--color-accent-border)] text-[var(--color-accent-text)] bg-[var(--color-accent-subtle)]',
    dot: 'bg-[var(--color-accent)]',
    card: 'border-[var(--color-accent-border)] border-l-[var(--color-accent)] bg-[var(--color-accent-subtle)]',
    accentText: 'text-[var(--color-accent-text)]',
    Icon: ShieldAlert,
  },
};

export function RiskBadge({
  risk,
  className,
}: {
  risk: PermissionRisk;
  className?: string;
}) {
  const s = RISK_STYLE[risk];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-1.5 h-5 shrink-0 border',
        'text-[10px] uppercase tracking-[0.08em] font-medium',
        s.badge,
        className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', s.dot)} />
      {RISK_LABELS[risk]}
    </span>
  );
}

/**
 * Tarjeta de "explicación previa" de un permiso. Se muestra cuando el operador
 * tiene un permiso seleccionado/enfocado, para que entienda qué hace y qué
 * puede pasar antes de otorgarlo.
 */
export function PermissionConsequenceCard({
  code,
  className,
}: {
  code: string;
  className?: string;
}) {
  const meta = getPermissionMeta(code);
  const s = RISK_STYLE[meta.risk];
  return (
    <div
      className={cn(
        'flex flex-col gap-2 p-3 border border-l-2',
        s.card,
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-[var(--color-fg)] tracking-tight">
          {meta.label}
        </span>
        <RiskBadge risk={meta.risk} />
      </div>

      <p className="text-[12px] text-[var(--color-fg-muted)] leading-snug">
        {meta.what}
      </p>

      {code.endsWith('_admin_network') && (
        <div className="flex items-start gap-2 px-2 py-1.5 border border-[var(--color-border)] bg-[var(--color-bg-subtle)]">
          <Info className="size-3.5 mt-0.5 shrink-0 text-[var(--color-fg-muted)]" />
          <p className="text-[11px] text-[var(--color-fg)] leading-snug">
            Restringido a la <strong>red del admin</strong> (Casa + socios
            dependientes + descendants). No alcanza a la sub-red del socio
            independiente.
          </p>
        </div>
      )}

      <div className="flex items-start gap-2 pt-1.5 border-t border-[var(--color-border)]">
        <s.Icon className={cn('size-3.5 mt-0.5 shrink-0', s.accentText)} />
        <div className="flex flex-col gap-0.5 min-w-0">
          <span
            className={cn(
              'text-[10px] uppercase tracking-[0.1em] font-medium',
              s.accentText,
            )}
          >
            Qué puede pasar si lo otorgás
          </span>
          <p className="text-[12px] text-[var(--color-fg)] leading-snug">
            {meta.consequence}
          </p>
        </div>
      </div>

      <span className="text-[10px] font-mono text-[var(--color-fg-subtle)] self-start">
        {code}
      </span>
    </div>
  );
}
