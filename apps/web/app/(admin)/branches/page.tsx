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
import { SellChipsModal } from '@/components/admin/sell-chips-modal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { hasPermission, useAuth } from '@/lib/auth-context';
import {
  useBranchSalesHistory,
  useBranchesList,
  type BranchListRow,
} from '@/lib/hooks/use-branches';
import { cn } from '@/lib/cn';
import { arDaysAgoDateStr, arEndOfDayIso, arStartOfDayIso, arTodayDateStr } from '@/lib/format-date';

export default function BranchesPage() {
  const [from, setFrom] = useState(arDaysAgoDateStr(30));
  const [to, setTo] = useState(arTodayDateStr());
  const [sellTarget, setSellTarget] = useState<BranchListRow | null>(null);
  const { user: actor } = useAuth();
  const canSell = hasPermission(actor, 'branch.sell_chips');

  const list = useBranchesList();
  // Convertir las fechas date-only (calendario AR) a ISO range (00:00 → 23:59 AR).
  const historyFilters = useMemo(() => {
    return { from: arStartOfDayIso(from), to: arEndOfDayIso(to) };
  }, [from, to]);
  const history = useBranchSalesHistory(historyFilters);

  const rows = list.data?.data ?? [];
  const activeCount = rows.filter((r) => r.status === 'active').length;
  const totalChips30d = rows.reduce((acc, r) => acc + Number(r.chipsSold30d), 0);
  const totalFiat30d = rows.reduce((acc, r) => acc + Number(r.fiatSold30d), 0);

  const saleRows = history.data?.data ?? [];
  const histChips = saleRows.reduce((acc, r) => acc + Number(r.amountChips), 0);
  const histFiat = saleRows.reduce((acc, r) => acc + Number(r.amountFiat), 0);

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-2">
        <div className="flex flex-col gap-2">
          <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
            <Store className="size-3" />
            Operación · Sucursales independientes
          </span>
          <h1 className="font-display text-3xl lg:text-[2.5rem] leading-none tracking-tight">
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
            history.refetch();
          }}
          disabled={list.isFetching || history.isFetching}
        >
          <RefreshCw
            className={cn('size-3', (list.isFetching || history.isFetching) && 'animate-spin')}
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
      <section className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto">
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
                {canSell && <TH className="text-right">Acción</TH>}
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
                        timeZone: 'America/Argentina/Buenos_Aires',
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })
                    ) : (
                      <Badge variant="neutral">sin ventas</Badge>
                    )}
                  </TD>
                  {canSell && (
                    <TD className="text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setSellTarget(r)}
                        title={`Vender fichas a @${r.username}`}
                      >
                        <Coins className="size-3" />
                        Vender fichas
                      </Button>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      {/* Sales history por operación */}
      <section className="flex flex-col gap-3">
        <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-2">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
              <FileBarChart2 className="size-3" />
              Historial de ventas
            </span>
            <h2 className="text-lg font-display tracking-tight">
              Cada operación de venta de fichas
            </h2>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-end gap-2">
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
        <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto">
          <div className="px-3 py-2 border-b border-[var(--color-border)] grid grid-cols-1 sm:grid-cols-3 gap-3">
            <SummaryStat
              label="Ventas en el rango"
              value={history.isLoading ? '…' : String(saleRows.length)}
            />
            <SummaryStat
              label="Fichas vendidas"
              value={history.isLoading ? '…' : String(histChips)}
            />
            <SummaryStat
              label="Fiat cobrado"
              value={history.isLoading ? '…' : `$${histFiat.toFixed(2)}`}
            />
          </div>
          {history.isLoading ? (
            <div className="p-4 flex flex-col gap-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : !saleRows.length ? (
            <EmptyState hint="branches-history" label="Sin ventas en el rango." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Fecha</TH>
                  <TH>Socio</TH>
                  <TH className="text-right">Fichas</TH>
                  <TH className="text-right">Precio por ficha</TH>
                  <TH className="text-right">Nos pagaron</TH>
                  <TH>Operador</TH>
                </TR>
              </THead>
              <TBody>
                {saleRows.map((r) => (
                  <TR key={r.walletTxId}>
                    <TD className="text-[11px] text-[var(--color-fg-muted)] whitespace-nowrap">
                      {new Date(r.createdAt).toLocaleString('es-AR', {
                        timeZone: 'America/Argentina/Buenos_Aires',
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </TD>
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
                    <TD className="text-right num font-mono">{r.amountChips}</TD>
                    <TD className="text-right num font-mono">
                      {Number(r.pricePerUnit).toFixed(4)}
                    </TD>
                    <TD className="text-right num font-mono text-[var(--color-fg-muted)]">
                      ${Number(r.amountFiat).toFixed(2)}
                    </TD>
                    <TD className="text-[11px] text-[var(--color-fg-muted)]">
                      {r.createdByUsername ? `@${r.createdByUsername}` : '—'}
                    </TD>
                  </TR>
                ))}
              </TBody>
              <tfoot>
                <TR className="bg-[var(--color-bg-subtle)]">
                  <TD colSpan={2} className="text-right text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
                    Total del rango
                  </TD>
                  <TD className="text-right num font-mono font-semibold">
                    {saleRows.reduce((acc, r) => acc + Number(r.amountChips), 0)}
                  </TD>
                  <TD />
                  <TD className="text-right num font-mono font-semibold text-[var(--color-accent-text)]">
                    $
                    {saleRows
                      .reduce((acc, r) => acc + Number(r.amountFiat), 0)
                      .toFixed(2)}
                  </TD>
                  <TD />
                </TR>
              </tfoot>
            </Table>
          )}
        </div>
      </section>

      <SellChipsModal
        open={sellTarget !== null}
        onOpenChange={(o) => {
          if (!o) setSellTarget(null);
        }}
        socio={sellTarget}
      />
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
        <span className="text-[11px] text-[var(--color-fg-subtle)] italic">{hint}</span>
      )}
    </div>
  );
}
