/**
 * /admin/branches — Sprint 51.1.
 *
 * Listado de sucursales independientes + reporting de ventas de fichas.
 *
 * Vista doble:
 *   - Cards de KPIs arriba: total sucursales, chips vendidas 30d, fiat 30d.
 *   - Tabla con cada sucursal: balance actual, ventas 30d, última venta.
 *   - Sales summary filtrable por rango (default: últimos 30 días).
 *
 * Permiso: `branch.view` (delegable). El admin para mutar usa el drawer
 * de user-detail (toggle + sell-chips), que requiere `branch.toggle_independence`
 * y `branch.sell_chips` — no delegables.
 */

'use client';

import { Building2, Coins, FileBarChart2, Landmark, RefreshCw, Store } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import {
  useBranchSalesSummary,
  useBranchesList,
} from '@/lib/hooks/use-branches';
import { cn } from '@/lib/cn';

function nDaysAgoIsoDate(days: number): string {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function BranchesPage() {
  const [from, setFrom] = useState(nDaysAgoIsoDate(30));
  const [to, setTo] = useState(todayIsoDate());

  const list = useBranchesList();
  // Convertir las fechas date-only a ISO range (00:00 inclusive → 23:59 inclusive).
  const summaryFilters = useMemo(() => {
    const fromIso = from ? new Date(`${from}T00:00:00.000Z`).toISOString() : undefined;
    const toIso = to ? new Date(`${to}T23:59:59.999Z`).toISOString() : undefined;
    return { from: fromIso, to: toIso };
  }, [from, to]);
  const summary = useBranchSalesSummary(summaryFilters);

  const rows = list.data?.data ?? [];
  const activeCount = rows.filter((r) => r.status === 'active').length;
  const totalChips30d = rows.reduce((acc, r) => acc + Number(r.chipsSold30d), 0);
  const totalFiat30d = rows.reduce((acc, r) => acc + Number(r.fiatSold30d), 0);

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <header className="flex items-end justify-between gap-6 pb-2">
        <div className="flex flex-col gap-2">
          <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
            <Store className="size-3" />
            Operación · Sucursales independientes
          </span>
          <h1 className="font-display text-[2.5rem] leading-none tracking-tight">
            Sucursales
          </h1>
          <p className="text-sm text-[var(--color-fg-muted)] mt-1">
            Socios marcados como sucursal independiente — operan con banco
            propio y reciben fichas del tenant al precio mayorista
            configurado por socio.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            list.refetch();
            summary.refetch();
          }}
          disabled={list.isFetching || summary.isFetching}
        >
          <RefreshCw
            className={cn('size-3', (list.isFetching || summary.isFetching) && 'animate-spin')}
          />
          Refrescar
        </Button>
      </header>

      {/* KPIs */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KpiCard
          icon={<Building2 className="size-4" />}
          label="Sucursales activas"
          value={list.isLoading ? '…' : String(activeCount)}
          hint={list.isLoading ? undefined : `${rows.length} total`}
        />
        <KpiCard
          icon={<Coins className="size-4" />}
          label="Fichas vendidas (30d)"
          value={list.isLoading ? '…' : totalChips30d.toLocaleString('es-AR')}
        />
        <KpiCard
          icon={<Landmark className="size-4" />}
          label="Fiat acumulado (30d)"
          value={list.isLoading ? '…' : `$${totalFiat30d.toFixed(2)}`}
        />
      </section>

      {/* Tabla de sucursales */}
      <section className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
        <div className="px-3 py-2 border-b border-[var(--color-border)]">
          <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium">
            {list.isLoading ? 'Cargando…' : `${rows.length} sucursales`}
          </span>
        </div>
        {list.isLoading ? (
          <div className="p-4 flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : list.isError ? (
          <EmptyState hint="branches" label="Error al cargar." />
        ) : rows.length === 0 ? (
          <EmptyState
            hint="branches"
            label="Sin sucursales independientes activas. Activá el modo desde el detalle de cada socio."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Socio</TH>
                <TH>Banco propio</TH>
                <TH className="text-right">Precio</TH>
                <TH className="text-right">Balance actual</TH>
                <TH className="text-right">Vendidas (30d)</TH>
                <TH className="text-right">Fiat (30d)</TH>
                <TH>Última venta</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.socioId}>
                  <TD>
                    <Link
                      href={`/users/${r.socioId}/wallet`}
                      className="flex flex-col gap-0.5 hover:underline"
                    >
                      <span className="text-[12px] text-[var(--color-fg)]">
                        {r.displayName}
                      </span>
                      <span className="text-[10px] text-[var(--color-fg-subtle)] font-mono">
                        @{r.username}
                      </span>
                    </Link>
                  </TD>
                  <TD className="text-[11px] font-mono text-[var(--color-fg-muted)]">
                    {r.branchBankAccount}
                  </TD>
                  <TD className="text-right num font-mono">
                    {Number(r.branchChipsPricePerUnit).toFixed(4)}
                  </TD>
                  <TD className="text-right num font-mono">{r.walletBalance}</TD>
                  <TD className="text-right num font-mono">{r.chipsSold30d}</TD>
                  <TD className="text-right num font-mono text-[var(--color-fg-muted)]">
                    ${Number(r.fiatSold30d).toFixed(2)}
                  </TD>
                  <TD className="text-[11px] text-[var(--color-fg-muted)]">
                    {r.lastSaleAt ? (
                      new Date(r.lastSaleAt).toLocaleString('es-AR', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })
                    ) : (
                      <Badge variant="neutral">sin ventas</Badge>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      {/* Sales summary con rango */}
      <section className="flex flex-col gap-3">
        <header className="flex items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
              <FileBarChart2 className="size-3" />
              Reporte de ventas
            </span>
            <h2 className="text-lg font-display tracking-tight">
              Ventas de fichas agregadas
            </h2>
          </div>
          <div className="flex items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="branches-from" className="text-[10px]">
                Desde
              </Label>
              <Input
                id="branches-from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-8 text-[12px]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="branches-to" className="text-[10px]">
                Hasta
              </Label>
              <Input
                id="branches-to"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-8 text-[12px]"
              />
            </div>
          </div>
        </header>
        <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
          <div className="px-3 py-2 border-b border-[var(--color-border)] grid grid-cols-3 gap-3">
            <SummaryStat
              label="Ventas en el rango"
              value={summary.isLoading ? '…' : String(summary.data?.totals.salesCount ?? 0)}
            />
            <SummaryStat
              label="Fichas vendidas"
              value={summary.isLoading ? '…' : (summary.data?.totals.totalChipsSold ?? '0')}
            />
            <SummaryStat
              label="Fiat estimado"
              value={summary.isLoading ? '…' : `$${summary.data?.totals.totalFiatSold ?? '0.00'}`}
              hint="precio usa el config actual de cada socio"
            />
          </div>
          {summary.isLoading ? (
            <div className="p-4 flex flex-col gap-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : !summary.data?.data.length ? (
            <EmptyState hint="branches-summary" label="Sin ventas en el rango." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Socio</TH>
                  <TH className="text-right">Ventas</TH>
                  <TH className="text-right">Fichas totales</TH>
                  <TH className="text-right">Precio actual</TH>
                  <TH className="text-right">Fiat estimado</TH>
                  <TH>Última venta</TH>
                </TR>
              </THead>
              <TBody>
                {summary.data.data.map((r) => (
                  <TR key={r.socioId}>
                    <TD>
                      <Link
                        href={`/users/${r.socioId}/wallet`}
                        className="flex flex-col gap-0.5 hover:underline"
                      >
                        <span className="text-[12px] text-[var(--color-fg)]">
                          {r.displayName}
                        </span>
                        <span className="text-[10px] text-[var(--color-fg-subtle)] font-mono">
                          @{r.username}
                        </span>
                      </Link>
                    </TD>
                    <TD className="text-right num font-mono">{r.salesCount}</TD>
                    <TD className="text-right num font-mono">{r.totalChipsSold}</TD>
                    <TD className="text-right num font-mono">
                      {r.branchChipsPricePerUnit
                        ? Number(r.branchChipsPricePerUnit).toFixed(4)
                        : '—'}
                    </TD>
                    <TD className="text-right num font-mono text-[var(--color-fg-muted)]">
                      ${Number(r.totalFiatSold).toFixed(2)}
                    </TD>
                    <TD className="text-[11px] text-[var(--color-fg-muted)]">
                      {r.lastSaleAt
                        ? new Date(r.lastSaleAt).toLocaleString('es-AR', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })
                        : '—'}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>
      </section>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-2 p-4 bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
      <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-1.5">
        {icon}
        {label}
      </span>
      <span className="font-display text-2xl tabular-nums tracking-tight">{value}</span>
      {hint && (
        <span className="text-[10px] text-[var(--color-fg-subtle)]">{hint}</span>
      )}
    </div>
  );
}

function SummaryStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)]">
        {label}
      </span>
      <span className="font-mono text-[14px] text-[var(--color-fg)] tabular-nums">
        {value}
      </span>
      {hint && (
        <span className="text-[9px] text-[var(--color-fg-subtle)] italic">{hint}</span>
      )}
    </div>
  );
}
