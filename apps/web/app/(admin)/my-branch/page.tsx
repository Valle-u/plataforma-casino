/**
 * /my-branch — Sprint 51.1.
 *
 * Self-view del socio independiente: su config + balance + history
 * de compras de fichas al tenant.
 *
 * Acceso: cualquier user logueado en el panel puede entrar. Si no es
 * socio o no está en modo independiente, mostramos un empty state
 * explicando qué pasa (no es error).
 */

'use client';

import { Building2, Coins, History, Landmark, RefreshCw, Wallet } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { useMyBranch } from '@/lib/hooks/use-branches';
import { cn } from '@/lib/cn';

export default function MyBranchPage() {
  const { data, isLoading, isError, refetch, isFetching } = useMyBranch(50);

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[1200px] mx-auto">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-2">
        <div className="flex flex-col gap-2">
          <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
            <Building2 className="size-3" />
            Mi sucursal
          </span>
          <h1 className="font-display text-3xl lg:text-[2.5rem] leading-none tracking-tight">
            Sucursal independiente
          </h1>
          <p className="text-sm text-[var(--color-fg-muted)] mt-1">
            Tu config + historial de fichas compradas al tenant.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={cn('size-3', isFetching && 'animate-spin')} />
          Refrescar
        </Button>
      </header>

      {isLoading && (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full bg-[var(--color-bg-subtle)]" />
          <Skeleton className="h-48 w-full bg-[var(--color-bg-subtle)]" />
        </div>
      )}

      {isError && <EmptyState hint="my-branch" label="Error al cargar tu sucursal." />}

      {data && !data.isIndependent && (
        <EmptyState
          hint="my-branch"
          label="No estás operando como sucursal independiente. Si querés activar el modo, pedile al admin del tenant que active el flag desde tu perfil."
        />
      )}

      {data && data.isIndependent && (
        <>
          {/* Config + KPIs */}
          <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard
              icon={<Wallet className="size-4" />}
              label="Balance actual"
              value={data.walletBalance}
              unit="fichas"
            />
            <KpiCard
              icon={<Coins className="size-4" />}
              label="Fichas compradas (all-time)"
              value={data.totals.chipsSoldAllTime}
              unit="fichas"
            />
            <KpiCard
              icon={<Landmark className="size-4" />}
              label="Fiat invertido (all-time)"
              value={`$${data.totals.fiatSoldAllTime}`}
              hint={`${data.totals.salesCount} compras`}
            />
            <KpiCard
              icon={<Building2 className="size-4" />}
              label="Precio mayorista"
              value={data.pricePerUnit ? Number(data.pricePerUnit).toFixed(4) : '—'}
              unit="por ficha"
            />
          </section>

          {/* Config bancaria */}
          <section className="flex flex-col gap-3 p-4 bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
            <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
              <Landmark className="size-3" />
              Banco propio
            </span>
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
                  Cuenta / alias
                </span>
                <span className="font-mono text-[14px] text-[var(--color-fg)]">
                  {data.bankAccount ?? '—'}
                </span>
              </div>
              <Badge variant="info" dot>
                INDEPENDENT
              </Badge>
            </div>
            <div className="text-[11px] text-[var(--color-fg-subtle)] italic">
              El admin del tenant es quien edita estos datos. Si cambia tu CBU
              o el precio acordado, pedile que lo actualice desde tu perfil.
            </div>
          </section>

          {/* History de compras */}
          <section className="flex flex-col gap-3">
            <header className="flex flex-wrap items-center gap-2">
              <History className="size-3 text-[var(--color-fg-muted)]" />
              <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium">
                Últimas {data.recentSales.length} compras
              </span>
            </header>
            <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto">
              {data.recentSales.length === 0 ? (
                <EmptyState
                  hint="my-branch-sales"
                  label="Todavía no te vendieron fichas. Cuando el admin haga la primera venta, aparecerá acá."
                />
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Fecha</TH>
                      <TH className="text-right">Fichas</TH>
                      <TH className="text-right">Precio</TH>
                      <TH className="text-right">Fiat equiv.</TH>
                      <TH>Vendido por</TH>
                      <TH>Notas</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {data.recentSales.map((s) => (
                      <TR key={s.walletTxId}>
                        <TD className="text-[11px] font-mono text-[var(--color-fg-muted)]">
                          {new Date(s.createdAt).toLocaleString('es-AR', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}
                        </TD>
                        <TD className="text-right num font-mono">+{s.amountChips}</TD>
                        <TD className="text-right num font-mono">
                          {Number(s.pricePerUnit).toFixed(4)}
                        </TD>
                        <TD className="text-right num font-mono text-[var(--color-fg-muted)]">
                          ${s.amountFiat}
                        </TD>
                        <TD className="text-[11px] font-mono text-[var(--color-fg-subtle)]">
                          @{s.createdByUsername ?? '?'}
                        </TD>
                        <TD className="text-[11px] text-[var(--color-fg-muted)] truncate max-w-[260px]" title={s.reason ?? undefined}>
                          {s.reason ?? '—'}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  unit,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit?: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-2 p-4 bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
      <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-1.5">
        {icon}
        {label}
      </span>
      <div className="flex items-baseline gap-1.5">
        <span className="font-display text-2xl tabular-nums tracking-tight">{value}</span>
        {unit && (
          <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)]">
            {unit}
          </span>
        )}
      </div>
      {hint && (
        <span className="text-[10px] text-[var(--color-fg-subtle)]">{hint}</span>
      )}
    </div>
  );
}
