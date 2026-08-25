/**
 * /my-branch — vista del operador ("Mi sucursal"), reorganizada por persona.
 *
 * Muestra SOLO las cards relevantes según quién sos:
 *   - Operador DEPENDIENTE (cobra comisión): Mi comisión del mes · Comisiones
 *     de mi red (delegar tasas) · Histórico.
 *   - Red INDEPENDIENTE: operador (socio/distri/cajero indep) → Mi flujo de
 *     fichas (compras) + sus métodos de pago; empleado de sucursal indep →
 *     solo sus métodos de pago.
 * Los métodos de pago de la red independiente viven ACÁ (self-managed); el
 * catálogo del tenant queda solo para el admin en /payment-methods.
 * Arriba, una tarjeta de identidad simple (rol + tasa/precio + tipo).
 */

'use client';

import { Building2, History, RefreshCw, Wallet } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { HelpNote } from '@/components/ui/help-note';
import { PageHeader } from '@/components/ui/page-header';
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { CollapsibleCard } from '@/components/admin/collapsible-card';
import {
  MyCommissionCurrent,
  MyCommissionHistory,
} from '@/components/admin/my-commission-summary';
import { MyChildRatesSection } from '@/components/admin/my-child-rates-section';
import { ChipFlowSection } from '@/components/admin/chip-flow-section';
import { NodePaymentMethodsSection } from '@/components/admin/node-payment-methods-section';
import { useMyBranch } from '@/lib/hooks/use-branches';
import { useMyCommissionSummary } from '@/lib/hooks/use-network-commissions';
import { useAuth, operatorAudience } from '@/lib/auth-context';
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
  const audience = operatorAudience(user);

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
    <PageShell className="max-w-[1100px]">
      <PageHeader
        icon={Building2}
        title="Mi sucursal"
        description={
          audience === 'dependent'
            ? 'Tu resumen como operador comercial: tus datos, tu comisión y el seguimiento de tu red.'
            : 'Tu resumen como sucursal independiente: tus datos, tu reventa de fichas y los cobros de tu red.'
        }
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={cn('size-3', isFetching && 'animate-spin')} />
            Refrescar
          </Button>
        }
      />

      <HelpNote id="my-branch">
        {audience === 'dependent' ? (
          <>
            Esta es tu página personal como <strong>operador comercial</strong>.
            Arriba ves tu <strong>identidad</strong>: tu rol y tu{' '}
            <strong>tasa de comisión</strong> (el % que cobrás sobre lo que mueve
            tu red). Abajo tenés <strong>tu comisión del mes</strong> y el{' '}
            <strong>histórico</strong> para hacerle seguimiento, y —si tenés
            operadores colgando de vos— las tasas que les delegás. Acá no se
            mueve plata: es tu negocio comercial y tu red.
          </>
        ) : (
          <>
            Esta es tu página personal como{' '}
            <strong>sucursal independiente</strong>. Arriba ves tu{' '}
            <strong>identidad</strong>: tu rol y tu{' '}
            <strong>precio mayorista</strong> por ficha (lo que pagás al comprar
            fichas para revender). Abajo bancás tu propia red: tu{' '}
            <strong>flujo de compra de fichas</strong> y los{' '}
            <strong>métodos de pago</strong> donde cobrás a tus jugadores.
          </>
        )}
      </HelpNote>

      {/* Tarjeta de identidad (siempre visible) */}
      {(op || data) && (
        <div className="flex flex-wrap items-center gap-x-10 gap-y-3 p-5 rounded-[var(--radius)] bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
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
              accent
            />
          ) : (
            op && (
              <IdentityField
                label="Mi tasa de comisión"
                value={`${op.rate}%`}
                accent
              />
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

      {/* Independiente sin CBU cargado: bloqueado de operar transferencias. El
          aviso apunta a la sección de métodos de pago de más abajo. */}
      {isIndependent && data && !data.bankAccount && (
        <div className="flex flex-col gap-1 p-3 rounded-[var(--radius-sm)] border border-[var(--color-warning)]">
          <span className="text-[12px] font-semibold text-[var(--color-warning)] uppercase tracking-[0.06em]">
            Falta cargar tu CBU/alias
          </span>
          <span className="text-[12px] text-[var(--color-fg-muted)] leading-relaxed">
            Todavía <strong>no podés operar transferencias bancarias</strong>.
            Cargá tu método de pago bancario (CBU/CVU o alias) más abajo, en{' '}
            <strong>Métodos de pago</strong> — ahí se habilitan las
            transferencias de tu sucursal.
          </span>
        </div>
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

      {/* ─────── Red INDEPENDIENTE (operador o empleado de sucursal indep) ──── */}
      {!earnsCommission && data && inIndependentNetwork && (
        <>
          {/* Flujo de fichas: solo operadores (socio/distri/cajero indep). */}
          {isOperator && <ChipFlowSection />}

          {/* Métodos de pago propios (self-managed) — operadores y empleados de
              la sucursal gestionan las cuentas donde cobran a sus jugadores. */}
          <NodePaymentMethodsSection />
        </>
      )}

      {/* ─────────────────────────── Sin sucursal ─────────────────────────── */}
      {!earnsCommission && data && !inIndependentNetwork && (
        <EmptyState
          hint="my-branch"
          label="Todavía no tenés una sucursal para gestionar. Si sos operador dependiente, tu comisión aparecerá acá cuando el admin compute un período. Si querés operar como sucursal independiente, pedile al admin que active el modo desde tu perfil."
        />
      )}
    </PageShell>
  );
}

function IdentityField({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  /** Resalta el valor en color de marca + mono (tasa / precio). */
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-semibold">
        {label}
      </span>
      <span className="flex items-baseline gap-1.5">
        <span
          className={cn(
            'text-[15px] font-semibold tabular-nums',
            accent
              ? 'font-mono text-[var(--color-accent-text)]'
              : 'text-[var(--color-fg)]',
          )}
        >
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
