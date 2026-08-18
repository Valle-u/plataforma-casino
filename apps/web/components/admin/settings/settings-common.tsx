/**
 * Piezas UI compartidas del nuevo /settings (rail de secciones).
 *
 * - SectionCard: contenedor estándar con header (título + descripción),
 *   body y footer opcional (SaveButton).
 * - SaveButton: botón de guardado sticky al pie de la sección.
 * - SettingRow / CustomSettingRow / ValueChip: filas de settings conocidos
 *   (extraídos del viejo /settings page) — se reusan en las secciones
 *   escalares y en los resultados del buscador global.
 */

'use client';

import { Loader2, Save } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';
import {
  type KnownSettingMeta,
  type SettingValueType,
  type TenantSettingRow,
} from '@/lib/hooks/use-tenant-settings';

// ──────────────────────────────────────────────────────────────────────
// SectionCard
// ──────────────────────────────────────────────────────────────────────

export function SectionCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius)]">
      <div className="px-5 pt-4 pb-3 border-b border-[var(--color-border)]">
        <h2 className="text-[15px] font-semibold text-[var(--color-fg)]">
          {title}
        </h2>
        {description && (
          <p className="text-[12px] text-[var(--color-fg-muted)] mt-0.5 leading-snug">
            {description}
          </p>
        )}
      </div>
      <div className="px-5 py-4 flex flex-col gap-4">{children}</div>
      {footer}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// SaveButton — sticky al pie del contenedor
// ──────────────────────────────────────────────────────────────────────

export function SaveButton({
  onClick,
  isSaving,
  label = 'Guardar cambios',
  savingLabel = 'Guardando…',
  disabled,
}: {
  onClick: () => void;
  isSaving: boolean;
  label?: string;
  savingLabel?: string;
  disabled?: boolean;
}) {
  return (
    <div className="sticky bottom-0 -mx-5 -mb-4 mt-2 border-t border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-5 pb-4 pt-3">
      <button
        type="button"
        onClick={onClick}
        disabled={isSaving || disabled}
        className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius)] bg-white py-2.5 text-sm font-semibold text-black shadow-sm transition-all duration-150 hover:brightness-110 hover:shadow-md active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:brightness-100 disabled:active:scale-100"
      >
        {isSaving ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Save className="size-4" />
        )}
        {isSaving ? savingLabel : label}
      </button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Rows
// ──────────────────────────────────────────────────────────────────────

export function SettingRow({
  meta,
  current,
  onEdit,
}: {
  meta: KnownSettingMeta;
  current: TenantSettingRow | undefined;
  onEdit: () => void;
}) {
  const hasOverride = !!current;
  const value = current?.value ?? meta.defaultValue;
  return (
    <li>
      <button
        type="button"
        onClick={onEdit}
        className="w-full text-left px-4 py-3 hover:bg-[var(--color-bg-subtle)] transition-colors border-l-2 border-l-transparent hover:border-l-[var(--color-accent)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[13px] text-[var(--color-fg)]">
                {meta.label}
              </span>
              {hasOverride ? (
                <Badge variant="success">custom</Badge>
              ) : (
                <Badge variant="neutral">default</Badge>
              )}
            </div>
            <span className="text-[10px] font-mono text-[var(--color-fg-subtle)] truncate">
              {meta.key}
            </span>
            <p className="text-[11px] text-[var(--color-fg-muted)] mt-1">
              {meta.description}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <ValueChip value={value} valueType={meta.valueType} />
            {hasOverride && (
              <span className="text-[10px] text-[var(--color-fg-subtle)] font-mono">
                modificado {formatDate(current.updatedAt)}
              </span>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}

export function CustomSettingRow({
  row,
  onEdit,
}: {
  row: TenantSettingRow;
  onEdit: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onEdit}
        className="w-full text-left px-4 py-3 hover:bg-[var(--color-bg-subtle)] transition-colors border-l-2 border-l-transparent hover:border-l-[var(--color-accent)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <span className="text-[12px] font-mono text-[var(--color-fg)] truncate">
              {row.key}
            </span>
            <span className="text-[10px] text-[var(--color-fg-subtle)] font-mono">
              modificado {formatDate(row.updatedAt)}
            </span>
          </div>
          <ValueChip value={row.value} valueType="json" />
        </div>
      </button>
    </li>
  );
}

export function ValueChip({
  value,
  valueType,
}: {
  value: unknown;
  valueType: SettingValueType;
}) {
  if (valueType === 'boolean') {
    return (
      <Badge variant={value === true ? 'success' : 'neutral'} dot>
        {value === true ? 'true' : 'false'}
      </Badge>
    );
  }
  if (valueType === 'number' || valueType === 'integer') {
    const safe =
      typeof value === 'number' || typeof value === 'string'
        ? String(value)
        : '—';
    return (
      <span className="text-[13px] font-mono tabular-nums text-[var(--color-fg)]">
        {value === undefined ? '—' : safe}
      </span>
    );
  }
  if (valueType === 'color' && typeof value === 'string') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="size-4 rounded-sm border border-[var(--color-border-strong)] shrink-0"
          style={{ backgroundColor: value }}
        />
        <span className="text-[12px] font-mono uppercase text-[var(--color-fg)]">
          {value}
        </span>
      </div>
    );
  }
  if (
    (valueType === 'url' || valueType === 'text') &&
    typeof value === 'string'
  ) {
    return (
      <span className="text-[11px] font-mono text-[var(--color-fg-muted)] truncate max-w-[280px]">
        {value}
      </span>
    );
  }
  let s: string;
  try {
    const j = JSON.stringify(value);
    s = j ?? String(value);
  } catch {
    s = String(value);
  }
  return (
    <span className="text-[11px] font-mono text-[var(--color-fg-muted)] truncate max-w-[280px]">
      {s.length > 60 ? s.slice(0, 60) + '…' : s}
    </span>
  );
}

export function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      day: '2-digit',
      month: 'short',
      year: '2-digit',
    });
  } catch {
    return iso;
  }
}

export { cn };
