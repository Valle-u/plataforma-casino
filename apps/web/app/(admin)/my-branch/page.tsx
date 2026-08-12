/**
 * /my-branch — vista del operador ("Mi sucursal"), reorganizada por persona.
 *
 * Muestra SOLO las cards relevantes según quién sos:
 *   - Operador DEPENDIENTE (cobra comisión): Mi comisión del mes · Comisiones
 *     de mi red (delegar tasas) · Histórico.
 *   - Socio INDEPENDIENTE: Mi reventa · Banco propio · Métodos de pago ·
 *     Historial de compras.
 *   - Empleado de sucursal independiente: Métodos de pago.
 * Arriba, una tarjeta de identidad simple (rol + tasa/precio + tipo).
 */

'use client';

import {
  Building2,
  Coins,
  History,
  Landmark,
  RefreshCw,
  Wallet,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { CollapsibleCard } from '@/components/admin/collapsible-card';
import {
  MyCommissionCurrent,
  MyCommissionHistory,
} from '@/components/admin/my-commission-summary';
import { MyChildRatesSection } from '@/components/admin/my-child-rates-section';
import { NodePaymentMethodsSection } from '@/components/admin/node-payment-methods-section';
import { useMyBranch } from '@/lib/hooks/use-branches';
import { useMyCommissionSummary } from '@/lib/hooks/use-network-commissions';
import { cn } from '@/lib/cn';

const ROLE_LABEL: Record<string, string> = {
  socio: 'Socio',
  distribuidor: 'Distribuidor',
  cajero: 'Cajero',
  operador: 'Operador',
};

export default function MyBranchPage() {
  const { data, isLoading, isError, refetch, isFetching } = useMyBranch(50);
  const summary = useMyCommissionSummary();

  const earnsCommission = summary.data?.earnsCommission ?? false;
  const isIndependent = data?.isIndependent ?? false;
  const underIndependent = data?.underIndependentBranch ?? false;
  const op = summary.data?.operator;

  const branchType = isIndependent
    ? 'Independiente'
    : underIndependent
      ? 'Bajo sucursal independiente'
      : 'Dependiente';

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[1100px] mx-auto">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-2">
        <div className="flex flex-col gap-2">
          <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
            <Building2 className="size-3" />
            Mi sucursal
          </span>
          <h1 className="font-display text-3xl lg:text-[2.5rem] leading-none tracking-tight">
            Mi sucursal
          </h1>
          <p className="text-sm text-[var(--color-fg-muted)] mt-1">
            Tu resumen como operador: tus datos, tu comisión o reventa, y tu red.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={cn('size-3', isFetching && 'animate-spin')} />
          Refrescar
        </Button>
      </header>

      {/* Tarjeta de identidad (siempre visible) */}
      {(op || data) && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4 bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
          <IdentityField
            label="Rol"
            value={ROLE_LABEL[op?.role ?? ''] ?? op?.role ?? 'Operador'}
          />
          {isIndependent ? (
            <IdentityField
              label="Precio mayorista"
              value={
                data?.pricePerUnit
                  ? Number(data.pricePerUnit).toFixed(4)
                  : '—'
              }
              hint="por ficha"
            />
          ) : (
            op && (
              <IdentityField label="Mi tasa de comisión" value={`${op.rate}%`} />
            )
          )}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
              Tipo de sucursal
            </span>
            <Badge variant={isIndependent ? 'info' : 'neutral'} dot>
              {branchType}
            </Badge>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full bg-[var(--color-bg-subtle)]" />
          <Skeleton className="h-48 w-full bg-[var(--color-bg-subtle)]" />
        </div>
      )}

      {isError && (
        <EmptyState hint="my-branch" label="Error al cargar tu sucursal." />
      )}

      {/* ─────────────── Operador DEPENDIENTE (cobra comisión) ─────────────── */}
      {earnsCommission && summary.data && (
        <>
          <CollapsibleCard
            title="Mi comisión del mes"
            icon={<Wallet className="size-4" />}
          >
            <MyCommissionCurrent summary={summary.data} />
          </CollapsibleCard>

          {/* Delegar tasas a mis hijos operadores (se auto-oculta si no tengo).
              Oculto para independientes (no cobran comisión, LEY C5). */}
          {!isIndependent && <MyChildRatesSection />}

          <CollapsibleCard
            title="Histórico de comisiones"
            icon={<History className="size-4" />}
          >
            <MyCommissionHistory summary={summary.data} />
          </CollapsibleCard>
        </>
      )}

      {/* ─────────────────────── Socio INDEPENDIENTE ─────────────────────── */}
      {!earnsCommission && data && isIndependent && (
        <>
          <CollapsibleCard title="Mi reventa" icon={<Coins className="size-4" />}>
            <div className="flex flex-col gap-4">
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
                  value={
                    data.pricePerUnit
                      ? Number(data.pricePerUnit).toFixed(4)
                      : '—'
                  }
                  unit="por ficha"
                />
              </section>
              <p className="text-[11px] text-[var(--color-fg-subtle)]">
                Como independiente ganás por <strong>margen de reventa</strong>:
                comprás fichas al tenant a tu precio mayorista y las revendés a tu
                red. No cobrás comisión de la plataforma (LEY C5).
              </p>
            </div>
          </CollapsibleCard>

          <CollapsibleCard
            title="Banco propio"
            icon={<Landmark className="size-4" />}
          >
            <div className="flex items-center justify-between gap-4">
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
            <p className="text-[11px] text-[var(--color-fg-subtle)] italic mt-3">
              El admin del tenant es quien edita estos datos. Si cambia tu CBU o
              el precio acordado, pedile que lo actualice desde tu perfil.
            </p>
          </CollapsibleCard>

          <NodePaymentMethodsSection />

          <CollapsibleCard
            title={`Historial de compras (${data.recentSales.length})`}
            icon={<History className="size-4" />}
            bodyClassName="p-0"
          >
            {data.recentSales.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  hint="my-branch-sales"
                  label="Todavía no te vendieron fichas. Cuando el admin haga la primera venta, aparecerá acá."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
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
                        <TD className="text-right num font-mono">
                          +{s.amountChips}
                        </TD>
                        <TD className="text-right num font-mono">
                          {Number(s.pricePerUnit).toFixed(4)}
                        </TD>
                        <TD className="text-right num font-mono text-[var(--color-fg-muted)]">
                          ${s.amountFiat}
                        </TD>
                        <TD className="text-[11px] font-mono text-[var(--color-fg-subtle)]">
                          @{s.createdByUsername ?? '?'}
                        </TD>
                        <TD
                          className="text-[11px] text-[var(--color-fg-muted)] truncate max-w-[260px]"
                          title={s.reason ?? undefined}
                        >
                          {s.reason ?? '—'}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            )}
          </CollapsibleCard>
        </>
      )}

      {/* ──────────── Empleado de sucursal independiente (solo pagos) ──────── */}
      {!earnsCommission && data && !isIndependent && underIndependent && (
        <NodePaymentMethodsSection />
      )}

      {/* ─────────────────────────── Sin sucursal ─────────────────────────── */}
      {!earnsCommission &&
        data &&
        !isIndependent &&
        !underIndependent && (
          <EmptyState
            hint="my-branch"
            label="Todavía no tenés una sucursal para gestionar. Si sos operador dependiente, tu comisión aparecerá acá cuando el admin compute un período. Si querés operar como sucursal independiente, pedile al admin que active el modo desde tu perfil."
          />
        )}
    </div>
  );
}

function IdentityField({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
        {label}
      </span>
      <span className="flex items-baseline gap-1.5">
        <span className="text-[15px] font-semibold text-[var(--color-fg)] tabular-nums">
          {value}
        </span>
        {hint && (
          <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)]">
            {hint}
          </span>
        )}
      </span>
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
    <div className="flex flex-col gap-2 p-4 bg-[var(--color-bg-subtle)] border border-[var(--color-border)]">
      <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-1.5">
        {icon}
        {label}
      </span>
      <div className="flex items-baseline gap-1.5">
        <span className="font-display text-2xl tabular-nums tracking-tight">
          {value}
        </span>
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
