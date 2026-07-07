/**
 * /network-commissions — Comisiones por red (modelo socios-only, C4).
 *
 * La plataforma le paga al SOCIO su % × NetWin de TODA su red. Desde acá el
 * admin: (1) fija el % de cada socio, (2) computa el período, (3) liquida en
 * fichas o plata real. Lo que el socio reparte hacia abajo es asunto suyo.
 *
 * Permisos: commissions.configure (config + compute), commissions.settle (liquidar).
 */

'use client';

import { Banknote, Calculator, Network, Percent, Play, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { SettleNetworkModal } from '@/components/admin/settle-network-modal';
import { isApiError } from '@/lib/api-client';
import { useAuth, isAdminTenant } from '@/lib/auth-context';
import {
  useComputeNetwork,
  useNetworkPeriods,
  useSetSocioRate,
  useSocioRates,
  type NetworkPeriodRow,
  type SocioRate,
} from '@/lib/hooks/use-network-commissions';
import { useSalariesList } from '@/lib/hooks/use-employee-salaries';

function fmt(x: string | number | null | undefined): string {
  if (x === null || x === undefined) return '—';
  const n = Number(x);
  if (!Number.isFinite(n)) return String(x);
  return n.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Mes anterior completo como 'YYYY-MM' (default operativo). */
function defaultPeriod(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ──────────────────────────────────────────────────────────────────────
// Fila editable de % por socio
// ──────────────────────────────────────────────────────────────────────

function SocioRateRow({ socio }: { socio: SocioRate }) {
  const setRate = useSetSocioRate();
  const [value, setValue] = useState(socio.commissionRate);

  useEffect(() => {
    setValue(socio.commissionRate);
  }, [socio.commissionRate]);

  const num = Number(value);
  const valid = Number.isFinite(num) && num >= 0 && num <= 100;
  const changed = valid && num !== Number(socio.commissionRate);

  async function save(): Promise<void> {
    if (!changed) return;
    try {
      await setRate.mutateAsync({ childUserId: socio.id, rate: num });
      toast.success(
        `Comisión de ${socio.displayName ?? socio.username} → ${num}%`,
      );
    } catch (err) {
      toast.error('No se pudo guardar', { description: mapRateError(err) });
      setValue(socio.commissionRate);
    }
  }

  return (
    <TR>
      <TD>
        <div className="flex flex-col">
          <span className="text-[13px] text-[var(--color-fg)]">
            {socio.displayName ?? socio.username}
          </span>
          <span className="text-[11px] text-[var(--color-fg-subtle)] font-mono">
            @{socio.username}
          </span>
        </div>
      </TD>
      <TD>
        {socio.isIndependent && <Badge variant="neutral">Independiente</Badge>}
      </TD>
      <TD className="text-right">
        {socio.isIndependent ? (
          <span className="text-[12px] text-[var(--color-fg-subtle)]">
            no aplica
          </span>
        ) : (
          <div className="flex items-center justify-end gap-1.5">
            <Input
              type="number"
              min="0"
              max="100"
              step="0.01"
              className="w-20 font-mono text-right"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save();
              }}
            />
            <span className="text-[12px] text-[var(--color-fg-subtle)]">%</span>
          </div>
        )}
      </TD>
      <TD className="text-right">
        {!socio.isIndependent && (
          <Button
            size="sm"
            variant="secondary"
            disabled={!changed || setRate.isPending}
            onClick={() => void save()}
          >
            Guardar
          </Button>
        )}
      </TD>
    </TR>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'paid') return <Badge variant="success">Pagado</Badge>;
  if (status === 'void') return <Badge variant="neutral">Anulado</Badge>;
  return <Badge variant="warning">Pendiente</Badge>;
}

/**
 * Celda de deducciones (F1). Muestra el total descontado; el desglose
 * (sueldos / banco / plataforma) va en el tooltip nativo. Si no hay
 * deducciones (socio indep o dep sin costos), muestra "—".
 */
function DeductionsCell({ row }: { row: NetworkPeriodRow }) {
  const salaries = Number(row.deductionsSalaries);
  const bank = Number(row.deductionsBankCost);
  const platform = Number(row.deductionsPlatformCost);
  const total = salaries + bank + platform;

  if (!(total > 0)) {
    return <span className="text-[12px] text-[var(--color-fg-subtle)]">—</span>;
  }

  return (
    <span
      className="text-[var(--color-danger)] cursor-help border-b border-dotted border-[var(--color-border)]"
      title={`Sueldos: ${fmt(salaries)} · Banco: ${fmt(bank)} · Plataforma: ${fmt(platform)}`}
    >
      −{fmt(total)}
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────────
// F1: listado de sueldos (read-only). Se editan desde el detalle de cada
// empleado; acá se ven todos juntos porque alimentan las deducciones.
// ──────────────────────────────────────────────────────────────────────

function SalariesSection() {
  const salaries = useSalariesList(true);
  const rows = salaries.data?.data ?? [];

  return (
    <section className="flex flex-col gap-2">
      <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium flex items-center gap-2">
        <Banknote className="size-3" />
        Sueldos de empleados
      </span>
      {salaries.isLoading ? (
        <Skeleton className="h-24" />
      ) : salaries.isError ? (
        <EmptyState hint="data" label="No se pudieron cargar los sueldos." />
      ) : rows.length === 0 ? (
        <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] p-4 text-[12px] text-[var(--color-fg-subtle)]">
          Todavía no fijaste sueldos. Configuralos desde el detalle de cada
          empleado en{' '}
          <Link
            href="/users"
            className="text-[var(--color-accent-text)] underline"
          >
            Usuarios
          </Link>
          .
        </div>
      ) : (
        <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
          <Table>
            <THead>
              <TR>
                <TH>Empleado</TH>
                <TH className="text-right">Sueldo mensual</TH>
                <TH>Actualizado</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.userId}>
                  <TD>
                    <div className="flex flex-col">
                      <span className="text-[13px] text-[var(--color-fg)]">
                        {r.displayName || r.username}
                      </span>
                      <span className="text-[11px] text-[var(--color-fg-subtle)] font-mono">
                        @{r.username}
                      </span>
                    </div>
                  </TD>
                  <TD className="text-right num font-mono">
                    {fmt(r.monthlyAmount)} {r.currency}
                  </TD>
                  <TD className="text-[11px] text-[var(--color-fg-subtle)]">
                    {r.updatedByUsername ? `@${r.updatedByUsername}` : '—'} ·{' '}
                    {new Date(r.updatedAt).toLocaleDateString('es-AR')}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
      <p className="text-[11px] text-[var(--color-fg-subtle)]">
        Los sueldos se descuentan del NetWin del socio dueño de la rama al
        computar el período. Se fijan desde el detalle de cada empleado.
      </p>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Página
// ──────────────────────────────────────────────────────────────────────

export default function NetworkCommissionsPage() {
  const { user } = useAuth();
  const socios = useSocioRates();
  const [period, setPeriod] = useState(defaultPeriod());
  const compute = useComputeNetwork();
  const periods = useNetworkPeriods(period);
  const [settleOpen, setSettleOpen] = useState(false);

  const rows: NetworkPeriodRow[] = periods.data?.periods ?? [];
  // F1: lo liquidable es finalCommission (payable − deducciones). Una fila con
  // payable > 0 pero finalCommission = 0 (las deducciones se comieron todo) NO
  // se liquida — settlePeriods la saltea. Filtramos por finalCommission para no
  // mostrar un total/conteo que después no se paga.
  const pending = rows.filter(
    (r) => r.status === 'accrued' && Number(r.finalCommission) > 0,
  );
  const totalPending = pending.reduce(
    (s, r) => s + Number(r.finalCommission),
    0,
  );

  const canSettle =
    user?.effectivePermissions === undefined ||
    user.effectivePermissions.includes('commissions.settle');

  async function handleCompute(): Promise<void> {
    try {
      const res = await compute.mutateAsync({ period });
      toast.success(
        `Período ${period}: ${res.sociosComputed} socio(s), ${fmt(res.totalPayable)} a pagar`,
      );
      void periods.refetch();
    } catch (err) {
      toast.error('No se pudo computar', { description: mapComputeError(err) });
    }
  }

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[1100px] mx-auto">
      {/* Header */}
      <header className="flex flex-col gap-2 pb-2">
        <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
          <Network className="size-3" />
          Negocio · Comisiones por red
        </span>
        <h1 className="font-display text-[2.5rem] leading-none tracking-tight">
          Comisiones por red
        </h1>
        <p className="text-sm text-[var(--color-fg-muted)] mt-1 max-w-2xl">
          La plataforma le paga a cada <strong>socio</strong> su % sobre la{' '}
          <strong>NetWin de toda su red</strong> (lo apostado menos lo ganado).
          Lo que el socio reparte a sus distribuidores y cajeros es asunto suyo,
          por fuera de la plataforma.
        </p>
      </header>

      {/* Sección 1: % por socio */}
      <section className="flex flex-col gap-2">
        <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium flex items-center gap-2">
          <Percent className="size-3" />
          Comisión por socio
        </span>
        {socios.isLoading ? (
          <Skeleton className="h-32" />
        ) : socios.isError || !socios.data ? (
          <EmptyState hint="data" label="No se pudo cargar la lista de socios." />
        ) : socios.data.socios.length === 0 ? (
          <EmptyState hint="data" label="Todavía no hay socios en este tenant." />
        ) : (
          <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
            <Table>
              <THead>
                <TR>
                  <TH>Socio</TH>
                  <TH></TH>
                  <TH className="text-right">% de comisión</TH>
                  <TH className="text-right"></TH>
                </TR>
              </THead>
              <TBody>
                {socios.data.socios.map((s) => (
                  <SocioRateRow key={s.id} socio={s} />
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </section>

      {/* Sección 1.5: Sueldos de empleados (F1) — admin-only */}
      {isAdminTenant(user) && <SalariesSection />}

      {/* Sección 2: Computar período */}
      <section className="flex flex-col gap-2">
        <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium flex items-center gap-2">
          <Calculator className="size-3" />
          Computar período
        </span>
        <div className="flex flex-wrap items-end gap-3 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] p-4">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="period"
              className="text-[11px] text-[var(--color-fg-subtle)]"
            >
              Mes
            </label>
            <Input
              id="period"
              type="month"
              className="font-mono"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            />
          </div>
          <Button
            variant="primary"
            size="md"
            onClick={() => void handleCompute()}
            disabled={compute.isPending || !period}
          >
            {compute.isPending ? (
              <>
                <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                Computando…
              </>
            ) : (
              <>
                <Play className="size-3.5" />
                Computar
              </>
            )}
          </Button>
          <p className="text-[11px] text-[var(--color-fg-subtle)] flex-1 min-w-[200px]">
            Calcula la comisión de cada socio sobre la NetWin del mes. Es
            idempotente: podés recomputar las veces que quieras (no toca lo ya
            liquidado).
          </p>
        </div>
      </section>

      {/* Sección 3: Resultados del período */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium flex items-center gap-2">
            <Wallet className="size-3" />
            Resultados de {period}
          </span>
          {canSettle && pending.length > 0 && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setSettleOpen(true)}
            >
              Liquidar {pending.length} pendiente(s)
            </Button>
          )}
        </div>
        {periods.isLoading ? (
          <Skeleton className="h-28" />
        ) : periods.isError || !periods.data ? (
          <EmptyState hint="data" label="No se pudieron cargar los resultados." />
        ) : rows.length === 0 ? (
          <EmptyState
            hint="data"
            label="No hay resultados para este mes. Computá el período para generarlos."
          />
        ) : (
          <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
            <Table>
              <THead>
                <TR>
                  <TH>Socio</TH>
                  <TH className="text-right">NetWin de la red</TH>
                  <TH className="text-right">Comisión</TH>
                  <TH className="text-right">Arrastre</TH>
                  <TH className="text-right">Deducciones</TH>
                  <TH className="text-right">A cobrar</TH>
                  <TH>Estado</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.operatorUserId}>
                    <TD className="text-[12px]">
                      {r.operatorUsername ? `@${r.operatorUsername}` : '—'}
                    </TD>
                    <TD className="text-right num font-mono text-[var(--color-fg-muted)]">
                      {fmt(r.subNetWin)}
                    </TD>
                    <TD className="text-right num font-mono">
                      {fmt(r.grossCommission)}
                    </TD>
                    <TD className="text-right num font-mono text-[var(--color-fg-subtle)]">
                      {Number(r.carryoverIn) === 0 ? '—' : fmt(r.carryoverIn)}
                    </TD>
                    <TD className="text-right num font-mono">
                      <DeductionsCell row={r} />
                    </TD>
                    <TD className="text-right num font-mono text-[var(--color-success)]">
                      {fmt(r.finalCommission)}
                    </TD>
                    <TD>
                      <StatusBadge status={r.status} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
        <p className="text-[11px] text-[var(--color-fg-subtle)]">
          “A cobrar” = comisión del mes + arrastre −{' '}
          <strong>deducciones</strong> (sueldos de sus empleados + costo
          bancario + costo de plataforma que la Casa recupera del socio). Nunca
          baja de 0. Si la red dio negativo, la deuda se arrastra al mes
          siguiente. Pasá el mouse sobre una deducción para ver el desglose.
        </p>
      </section>

      <SettleNetworkModal
        open={settleOpen}
        onOpenChange={setSettleOpen}
        period={period}
        pendingCount={pending.length}
        totalPayable={String(totalPending)}
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Errores
// ──────────────────────────────────────────────────────────────────────

function mapRateError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.code === 'RATE_EXCEEDS_PARENT')
    return 'No podés cobrar más del 100%.';
  if (err.code === 'NOT_DIRECT_CHILD')
    return 'Solo el admin fija el % de los socios.';
  if (err.status === 403) return 'No tenés permiso.';
  if (err.status === 400) return err.message || 'Valor inválido (0–100).';
  return err.message || 'Error inesperado.';
}

function mapComputeError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.code === 'CONSERVATION_VIOLATED')
    return 'Hay socios anidados (un socio cuelga de otro). Corregí la jerarquía.';
  if (err.code === 'INVALID_PERIOD') return 'Período inválido.';
  if (err.status === 403) return 'No tenés permiso para computar.';
  return err.message || 'Error inesperado.';
}
