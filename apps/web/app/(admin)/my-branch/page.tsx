/**
 * /my-branch — vista del operador ("Mi sucursal"), reorganizada por persona.
 *
 * Muestra SOLO las cards relevantes según quién sos:
 *   - Operador DEPENDIENTE (cobra comisión): Mi comisión del mes · Comisiones
 *     de mi red (delegar tasas) · Histórico.
 *   - Operador de red INDEPENDIENTE (socio/distri/cajero indep): Mi flujo de
 *     fichas (compras + ventas a hijos) · Banco propio (solo el titular).
 *   - Empleado de sucursal independiente: aviso → sus métodos de pago viven en
 *     la sección "Métodos de pago".
 * Los métodos de pago NO se muestran acá (viven en /payment-methods).
 * Arriba, una tarjeta de identidad simple (rol + tasa/precio + tipo).
 */

'use client';

import { Building2, CreditCard, History, RefreshCw, Wallet } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { CollapsibleCard } from '@/components/admin/collapsible-card';
import {
  MyCommissionCurrent,
  MyCommissionHistory,
} from '@/components/admin/my-commission-summary';
import { MyChildRatesSection } from '@/components/admin/my-child-rates-section';
import { ChipFlowSection } from '@/components/admin/chip-flow-section';
import { useMyBranch } from '@/lib/hooks/use-branches';
import { useMyCommissionSummary } from '@/lib/hooks/use-network-commissions';
import { useAuth } from '@/lib/auth-context';
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
  const { user } = useAuth();

  const earnsCommission = summary.data?.earnsCommission ?? false;
  const isIndependent = data?.isIndependent ?? false;
  const underIndependent = data?.underIndependentBranch ?? false;
  const inIndependentNetwork = isIndependent || underIndependent;
  const isOperator = (user?.roles ?? []).some((r) =>
    ['socio', 'distribuidor', 'cajero'].includes(r),
  );
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

      {/* ───────── Operador de red INDEPENDIENTE (socio/distri/cajero) ─────── */}
      {!earnsCommission && data && inIndependentNetwork && isOperator && (
        <>
          <ChipFlowSection />

          <p className="text-[11px] text-[var(--color-fg-subtle)] flex items-center gap-1.5">
            <CreditCard className="size-3" />
            Configurás tus CBUs/cuentas para cobrar en la sección{' '}
            <strong>Métodos de pago</strong> del menú.
          </p>
        </>
      )}

      {/* ──────── Empleado de sucursal independiente (no operador) ────────── */}
      {!earnsCommission && data && inIndependentNetwork && !isOperator && (
        <EmptyState
          hint="my-branch-employee"
          label="Gestioná los métodos de pago de tu sucursal desde la sección 'Métodos de pago' del menú."
        />
      )}

      {/* ─────────────────────────── Sin sucursal ─────────────────────────── */}
      {!earnsCommission && data && !inIndependentNetwork && (
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
