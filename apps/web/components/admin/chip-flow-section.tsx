/**
 * ChipFlowSection — flujo de fichas de un operador de red independiente (R4).
 * Muestra KPIs (compradas / vendidas / en stock / margen estimado) + dos
 * historiales: COMPRAS (lo que recibió del padre/tenant) y VENTAS (lo que le
 * cargó a sus hijos directos). Self-fetch; se auto-oculta ante error.
 */

'use client';

import { ArrowDownLeft, ArrowUpRight, Coins } from 'lucide-react';
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
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi
              label="Fichas compradas"
              value={fmt(data.totals.comprasChips)}
              hint={`≈ $${fmt(data.totals.comprasFiat)}`}
            />
            <Kpi
              label="Fichas vendidas"
              value={fmt(data.totals.ventasChips)}
              hint={`≈ $${fmt(data.totals.ventasFiat)}`}
            />
            <Kpi label="En stock (balance)" value={fmt(data.totals.balance)} />
            <Kpi
              label="Margen estimado"
              value={`$${fmt(data.totals.margenEstimado)}`}
              tone={Number(data.totals.margenEstimado) >= 0 ? 'success' : 'danger'}
              hint="ventas − compras"
            />
          </div>
          <p className="text-[11px] text-[var(--color-fg-subtle)]">
            Ganás por <strong>margen de reventa</strong>: comprás fichas a tu
            padre y las revendés a tus hijos a tu precio. El fiat y el margen son{' '}
            <strong>estimados</strong>.
          </p>

          {/* Compras */}
          <FlowTable
            title="Compras (fichas que recibí)"
            icon={<ArrowDownLeft className="size-3.5" />}
            partyLabel="De"
            rows={data.compras}
            emptyLabel="Todavía no compraste fichas."
          />

          {/* Ventas */}
          <FlowTable
            title="Ventas a mis hijos"
            icon={<ArrowUpRight className="size-3.5" />}
            partyLabel="A"
            rows={data.ventas}
            emptyLabel="Todavía no le vendiste fichas a ningún hijo."
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
        <div className="border border-[var(--color-border)] overflow-x-auto">
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
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </td>
                  <td className="p-2.5 text-right tabular-nums font-mono">
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
  tone?: 'success' | 'danger';
}) {
  const color =
    tone === 'success'
      ? 'var(--color-success, #22c55e)'
      : tone === 'danger'
        ? '#ef4444'
        : 'var(--color-fg)';
  return (
    <div className="flex flex-col gap-1 p-3 bg-[var(--color-bg-subtle)] border border-[var(--color-border)]">
      <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-muted)]">
        {label}
      </span>
      <span
        className="font-display text-xl tabular-nums tracking-tight"
        style={{ color }}
      >
        {value}
      </span>
      {hint && (
        <span className="text-[10px] text-[var(--color-fg-subtle)]">{hint}</span>
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
