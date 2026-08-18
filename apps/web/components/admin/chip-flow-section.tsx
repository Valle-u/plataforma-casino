/**
 * ChipFlowSection — flujo de fichas de un operador de red independiente (R4).
 * Muestra KPIs (compradas / vendidas / en stock / margen estimado) + dos
 * historiales: COMPRAS (lo que recibió del padre/tenant) y VENTAS (lo que le
 * cargó a sus hijos directos). Self-fetch; se auto-oculta ante error.
 */

'use client';

import { ArrowDownLeft, Coins } from 'lucide-react';
import { CollapsibleCard } from '@/components/admin/collapsible-card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useMyChipFlow,
  type ChipFlowEntry,
} from '@/lib/hooks/use-branches';

function fmt(x: string | number): string {
  const n = Number(x);
  if (!Number.isFinite(n)) return String(x);
  return n.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function ChipFlowSection() {
  const { data, isLoading, isError } = useMyChipFlow();

  return (
    <CollapsibleCard
      title="Mi flujo de fichas"
      icon={<Coins className="size-4" />}
      bodyClassName="flex flex-col gap-4"
    >
      {isLoading ? (
        <Skeleton className="h-40 w-full bg-[var(--color-bg-subtle)]" />
      ) : isError || !data ? (
        <EmptyState hint="chip-flow" label="No se pudo cargar tu flujo de fichas." />
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3">
            <Kpi
              label="Fichas compradas"
              value={fmt(data.totals.comprasChips)}
              hint={`≈ $${fmt(data.totals.comprasFiat)}`}
            />
            <Kpi
              label="En stock (balance)"
              value={fmt(data.totals.balance)}
              tone="accent"
            />
          </div>
          <p className="text-[11px] text-[var(--color-fg-subtle)]">
            Acá ves las fichas que <strong>compraste</strong> (a tu padre o al
            tenant), con su precio y fecha. El fiat es <strong>estimado</strong>.
          </p>

          {/* Compras */}
          <FlowTable
            title="Compras (fichas que recibí)"
            icon={<ArrowDownLeft className="size-3.5" />}
            partyLabel="De"
            rows={data.compras}
            emptyLabel="Todavía no compraste fichas."
          />
        </>
      )}
    </CollapsibleCard>
  );
}

function FlowTable({
  title,
  icon,
  partyLabel,
  rows,
  emptyLabel,
}: {
  title: string;
  icon: React.ReactNode;
  partyLabel: string;
  rows: ChipFlowEntry[];
  emptyLabel: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-fg-muted)] font-medium flex items-center gap-1.5">
        {icon}
        {title}
      </span>
      {rows.length === 0 ? (
        <EmptyState hint="chip-flow-rows" label={emptyLabel} />
      ) : (
        <div className="border border-[var(--color-border)] rounded-[var(--radius)] overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-subtle)]">
                <Th>Fecha</Th>
                <Th className="text-right">Fichas</Th>
                <Th className="text-right">Fiat estimado</Th>
                <Th>{partyLabel}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-[var(--color-border)] last:border-0"
                >
                  <td className="p-2.5 text-[11px] font-mono text-[var(--color-fg-muted)]">
                    {new Date(r.createdAt).toLocaleString('es-AR', {
                      timeZone: 'America/Argentina/Buenos_Aires',
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </td>
                  <td className="p-2.5 text-right tabular-nums font-mono text-[var(--color-success)]">
                    {fmt(r.chips)}
                  </td>
                  <td className="p-2.5 text-right tabular-nums font-mono text-[var(--color-fg-muted)]">
                    ${fmt(r.fiat)}
                  </td>
                  <td className="p-2.5 text-[12px]">
                    {r.counterpartyDisplayName ??
                      r.counterpartyUsername ??
                      '—'}
                    {r.counterpartyUsername &&
                      r.counterpartyUsername !== 'Casa' &&
                      !r.counterpartyUsername.startsWith('__') && (
                        <span className="text-[11px] font-mono text-[var(--color-fg-subtle)] ml-1">
                          @{r.counterpartyUsername}
                        </span>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'success' | 'danger' | 'accent';
}) {
  const color =
    tone === 'success'
      ? 'var(--color-success)'
      : tone === 'danger'
        ? 'var(--color-danger)'
        : tone === 'accent'
          ? 'var(--color-accent-text)'
          : 'var(--color-fg)';
  return (
    <div className="flex flex-col gap-1.5 p-4 rounded-[var(--radius)] bg-[var(--color-bg)] border border-[var(--color-border)]">
      <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-semibold">
        {label}
      </span>
      <span
        className="font-display text-2xl leading-none tabular-nums tracking-tight"
        style={{ color }}
      >
        {value}
      </span>
      {hint && (
        <span className="text-[11px] font-mono text-[var(--color-fg-subtle)]">
          {hint}
        </span>
      )}
    </div>
  );
}

function Th({
  children,
  className = '',
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`p-2.5 text-left text-[11px] uppercase tracking-[0.06em] font-medium text-[var(--color-fg-muted)] ${className}`}
    >
      {children}
    </th>
  );
}
