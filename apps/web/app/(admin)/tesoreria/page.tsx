/**
 * /tesoreria — La Casa / tesorería.
 *
 * Rediseño 2026-08: dashboard limpio (handoff Tesoreria.dc.html). La caja
 * central del casino en cuatro bloques: banner de salud, KPIs, dos gráficos
 * (saldo 30 días + fondeos por mes) y dos paneles (cupos de empleados +
 * topes de apuesta). El detalle de fondeos queda colapsable. Se reusan todos
 * los hooks/datos — no se toca la lógica de la Casa.
 *
 * Permiso: house.view. Solo admin_tenant.
 */

'use client';

import {
  Coins,
  Gauge,
  Plus,
  TrendingDown,
  TrendingUp,
  UserCog,
  Vault,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CollapsibleCard } from '@/components/admin/collapsible-card';
import { EmptyState } from '@/components/ui/empty-state';
import { HelpNote } from '@/components/ui/help-note';
import { KpiTile } from '@/components/ui/kpi-tile';
import { PageHeader } from '@/components/ui/page-header';
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AssignEmployeeCapModal } from '@/components/admin/assign-employee-cap-modal';
import { EditBettingCapsModal } from '@/components/admin/edit-betting-caps-modal';
import { EditCorrectionCapModal } from '@/components/admin/edit-correction-cap-modal';
import { InjectBudgetModal } from '@/components/admin/inject-budget-modal';
import { StockAlertBanner } from '@/components/admin/stock-alert-banner';
import { isApiError } from '@/lib/api-client';
import { isIndependentBranch, useAuth } from '@/lib/auth-context';
import {
  useBettingCaps,
  useCapitalInjections,
  useHouseBalanceHistory,
  useHouseState,
  useHouseStockAlert,
  useMintBudget,
} from '@/lib/hooks/use-house';
import {
  useEmployeesWithCap,
  type EmployeeWithCap,
} from '@/lib/hooks/use-correction';
import { cn } from '@/lib/cn';

function fmt(x: string | null | undefined): string {
  if (x === null || x === undefined) return '—';
  const n = Number(x);
  if (!Number.isFinite(n)) return String(x);
  return n.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Versión abreviada para las tarjetas KPI (1.23M, 500k, etc). */
function fmtKpi(x: string | null | undefined): string {
  if (x === null || x === undefined) return '—';
  const n = Number(x);
  if (!Number.isFinite(n)) return String(x);
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return n.toLocaleString('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function ChartTooltip({
  active,
  payload,
  label,
  valueLabel,
}: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
  valueLabel?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-lg px-3 py-2 text-xs shadow-lg"
      style={{
        background: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border-strong)',
        color: 'var(--color-fg)',
      }}
    >
      <div className="font-medium mb-1">{label}</div>
      <div className="tabular-nums">
        {valueLabel ? `${valueLabel}: ` : ''}
        {payload[0]?.value.toLocaleString('es-AR', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
      </div>
    </div>
  );
}

export default function TesoreriaPage() {
  const house = useHouseState();
  const injections = useCapitalInjections();
  const { user } = useAuth();
  const indepMode = isIndependentBranch(user);
  const operatorUserId = indepMode ? (user?.id ?? null) : null;
  const stockAlert = useHouseStockAlert(operatorUserId);
  const balanceHistory = useHouseBalanceHistory(30);
  const monthlyInjections = useMemo(() => {
    if (!injections.data?.injections) return [];
    const map = new Map<string, number>();
    for (const inj of injections.data.injections) {
      const month = inj.createdAt.slice(0, 7);
      map.set(month, (map.get(month) ?? 0) + Number(inj.amount));
    }
    return Array.from(map.entries())
      .map(([month, amount]) => ({ month, amount }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }, [injections.data]);
  // Variación del saldo en la ventana (primer vs último punto) para el chip.
  const balanceDelta = useMemo(() => {
    const h = balanceHistory.data?.history;
    if (!h || h.length < 2) return null;
    const first = Number(h[0]!.balance);
    const last = Number(h[h.length - 1]!.balance);
    if (!Number.isFinite(first) || first === 0) return null;
    return ((last - first) / first) * 100;
  }, [balanceHistory.data]);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const mintBudget = useMintBudget();
  const canEditCap =
    user?.effectivePermissions === undefined ||
    user.effectivePermissions.includes('users.edit');
  const employees = useEmployeesWithCap(canEditCap);
  const [capEditing, setCapEditing] = useState<EmployeeWithCap | null>(null);
  const [assignCapOpen, setAssignCapOpen] = useState(false);
  const notProvisioned =
    house.isError && isApiError(house.error) && house.error.status === 404;
  const canInject =
    user?.effectivePermissions === undefined ||
    user.effectivePermissions.includes('house.inject_capital');
  const caps = useBettingCaps();
  const [capsOpen, setCapsOpen] = useState(false);
  const canEditCaps =
    user?.effectivePermissions === undefined ||
    user.effectivePermissions.includes('tenant.settings.edit');

  const stockLevel = stockAlert.data?.level;

  return (
    <PageShell className="max-w-[1180px]">
      {/* ─── Header ─── */}
      <PageHeader
        icon={Vault}
        title="Tesorería · la Casa"
        description="La caja central del casino: la única cuenta que crea fichas y con la que se cruza todo (depósitos, apuestas, premios). Su saldo es la ganancia real del negocio."
        actions={
          canInject && !notProvisioned ? (
            <Button
              variant="primary"
              size="md"
              onClick={() => setBudgetOpen(true)}
              title="Crear fichas nuevas. Limitado por el tope del mes, salvo que marques Fondeo."
            >
              <Plus className="size-3.5" />
              Fondear presupuesto
            </Button>
          ) : undefined
        }
      />

      <HelpNote id="tesoreria">
        La <strong>Casa</strong> es la caja del casino: la{' '}
        <strong>única cuenta que crea fichas nuevas</strong> y la contraparte de
        todo. Para crear fichas usás <strong>“Fondear presupuesto”</strong>, con
        un <strong>tope por mes</strong>. Acá ves su <strong>saldo</strong> y su
        evolución, los <strong>cupos</strong> de los empleados (cuánto pueden
        cargar por corrección al mes) y los <strong>topes de apuesta</strong>{' '}
        (para que un bug o un fraude no te generen deuda con el proveedor).
      </HelpNote>

      {/* ─── Banner de salud ─── */}
      {!notProvisioned && (
        <StockAlertBanner
          operatorUserId={operatorUserId}
          showInjectCta={!indepMode && canInject}
        />
      )}

      {/* ─── KPIs de la Casa ─── */}
      {house.isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-[104px] rounded-[var(--radius)] bg-[var(--color-bg-subtle)]"
            />
          ))}
        </div>
      ) : notProvisioned ? (
        <EmptyState
          hint="data"
          label="La Casa todavía no está provisionada en este tenant. Se crea al migrar/seedear."
        />
      ) : house.isError || !house.data ? (
        <EmptyState
          hint="data"
          label="No se pudo cargar el estado de la Casa. Verificá la conexión."
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <KpiTile
            label="Balance total"
            icon={Vault}
            value={fmtKpi(house.data.balance)}
            hint="Fichas en la Casa"
          />
          <KpiTile
            label="Bloqueado"
            value={fmtKpi(house.data.lockedBalance)}
            hint="En holds / retiros"
          />
          <KpiTile
            label="Disponible"
            icon={Coins}
            value={fmtKpi(
              String(
                Number(house.data.balance) - Number(house.data.lockedBalance),
              ),
            )}
            tone={
              stockLevel === 'critical'
                ? 'danger'
                : stockLevel === 'low'
                  ? 'warning'
                  : 'success'
            }
            hint={
              stockLevel
                ? stockLevel === 'ok'
                  ? 'Saludable'
                  : stockLevel === 'low'
                    ? 'Bajo'
                    : 'Crítico'
                : undefined
            }
          />
          <KpiTile
            label="Fichas creadas / mes"
            value={mintBudget.data ? fmtKpi(mintBudget.data.mintedThisMonth) : '…'}
            hint={
              mintBudget.data
                ? `Tope ${fmtKpi(mintBudget.data.monthlyBudget)}`
                : undefined
            }
          />
          <KpiTile
            label="Disponible del tope"
            icon={Gauge}
            value={mintBudget.data ? fmtKpi(mintBudget.data.available) : '…'}
            tone="success"
          />
        </div>
      )}

      {/* ─── Presupuesto mensual de minteo (tarjetón) ─── */}
      {!notProvisioned && mintBudget.data && (
        <MintBudgetCard
          monthly={mintBudget.data.monthlyBudget}
          minted={mintBudget.data.mintedThisMonth}
          available={mintBudget.data.available}
        />
      )}

      {/* ─── Gráficos ─── */}
      {!notProvisioned && (
        <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-3">
          {/* Saldo de la Casa · 30 días */}
          <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius)] p-5 flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <h2 className="font-display text-lg tracking-tight text-[var(--color-fg)]">
                  Saldo de la Casa · 30 días
                </h2>
                <span className="text-[12px] text-[var(--color-fg-muted)]">
                  Fichas disponibles día por día
                </span>
              </div>
              {balanceDelta !== null && (
                <span
                  className={cn(
                    'inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] font-semibold',
                    balanceDelta >= 0
                      ? 'bg-[var(--color-success-bg)] text-[var(--color-success)]'
                      : 'bg-[var(--color-danger-bg)] text-[var(--color-danger)]',
                  )}
                >
                  {balanceDelta >= 0 ? (
                    <TrendingUp className="size-3.5" />
                  ) : (
                    <TrendingDown className="size-3.5" />
                  )}
                  {balanceDelta >= 0 ? '+' : ''}
                  {balanceDelta.toFixed(1)}%
                </span>
              )}
            </div>
            {balanceHistory.isLoading ? (
              <Skeleton className="h-[210px]" />
            ) : balanceHistory.isError || !balanceHistory.data?.history ? (
              <div className="h-[210px] flex items-center justify-center text-xs text-[var(--color-fg-subtle)]">
                No se pudo cargar el historial
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={210}>
                <AreaChart
                  data={balanceHistory.data.history}
                  margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
                >
                  <defs>
                    <linearGradient id="balance-grad" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 5" stroke="var(--color-border)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d: string) => {
                      const dt = new Date(d + 'T00:00:00');
                      return dt.toLocaleDateString('es-AR', {
                        timeZone: 'America/Argentina/Buenos_Aires',
                        day: 'numeric',
                        month: 'short',
                      });
                    }}
                    tick={{ fontSize: 10, fill: 'var(--color-fg-subtle)' }}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: 'var(--color-fg-subtle)' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) =>
                      v >= 1e6
                        ? `${(v / 1e6).toFixed(1)}M`
                        : v >= 1e3
                          ? `${(v / 1e3).toFixed(0)}k`
                          : String(v)
                    }
                  />
                  <Tooltip content={<ChartTooltip valueLabel="Balance" />} />
                  <Area
                    type="monotone"
                    dataKey={(d: { balance: string }) => Number(d.balance)}
                    stroke="var(--color-accent)"
                    strokeWidth={2}
                    fill="url(#balance-grad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Fondeos por mes */}
          <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius)] p-5 flex flex-col gap-3">
            <div className="flex flex-col gap-0.5">
              <h2 className="font-display text-lg tracking-tight text-[var(--color-fg)]">
                Fondeos por mes
              </h2>
              <span className="text-[12px] text-[var(--color-fg-muted)]">
                Capital y presupuesto inyectados a la Casa
              </span>
            </div>
            {injections.isLoading ? (
              <Skeleton className="h-[210px]" />
            ) : injections.isError || !injections.data ? (
              <div className="h-[210px] flex items-center justify-center text-xs text-[var(--color-fg-subtle)]">
                No se pudieron cargar los fondeos
              </div>
            ) : monthlyInjections.length === 0 ? (
              <div className="h-[210px] flex items-center justify-center text-xs text-[var(--color-fg-subtle)]">
                Sin fondeos aún
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={210}>
                <BarChart
                  data={monthlyInjections}
                  margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
                >
                  <CartesianGrid strokeDasharray="3 5" stroke="var(--color-border)" vertical={false} />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 10, fill: 'var(--color-fg-subtle)' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: 'var(--color-fg-subtle)' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) =>
                      v >= 1e6
                        ? `${(v / 1e6).toFixed(1)}M`
                        : v >= 1e3
                          ? `${(v / 1e3).toFixed(0)}k`
                          : String(v)
                    }
                  />
                  <Tooltip content={<ChartTooltip valueLabel="Monto" />} />
                  <Bar
                    dataKey="amount"
                    fill="var(--color-accent)"
                    radius={[6, 6, 2, 2]}
                    barSize={28}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}

      {/* ─── Paneles: cupos + topes ─── */}
      {!notProvisioned && (
        <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-3">
          {/* Cupos de empleados */}
          {canEditCap && (
            <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius)] p-5 flex flex-col gap-3 min-w-0">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-lg tracking-tight text-[var(--color-fg)] flex items-center gap-2">
                  <UserCog className="size-4 text-[var(--color-info)]" />
                  Cupos de empleados
                </h2>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setAssignCapOpen(true)}
                >
                  <Plus className="size-3" />
                  Asignar cupo
                </Button>
              </div>
              <p className="text-[12px] text-[var(--color-fg-muted)] leading-relaxed">
                Empleados con permiso para hacer{' '}
                <strong>cargas por corrección / bonificación / reintegro</strong>.
                El cupo es un techo mensual: se resetea el 1° de cada mes.
              </p>
              {employees.isLoading ? (
                <Skeleton className="h-24" />
              ) : employees.isError || !employees.data ? (
                <EmptyState hint="data" label="No se pudo cargar la lista de empleados." />
              ) : employees.data.employees.length === 0 ? (
                <EmptyState
                  hint="data"
                  label="Todavía no hay empleados con cupo configurado."
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <THead>
                      <TR>
                        <TH>Empleado</TH>
                        <TH className="text-right">Cupo / mes</TH>
                        <TH className="text-right">Restante</TH>
                        <TH>Consumo</TH>
                        <TH></TH>
                      </TR>
                    </THead>
                    <TBody>
                      {employees.data.employees.map((emp) => {
                        const cap = Number(emp.cap);
                        const used = Number(emp.used);
                        const pct =
                          cap > 0 ? Math.min(100, Math.max(0, (used / cap) * 100)) : 0;
                        const nearFull = pct >= 90;
                        return (
                          <TR key={emp.userId}>
                            <TD className="text-[12px] text-[var(--color-fg)]">
                              <div className="flex flex-col leading-tight min-w-0">
                                <span className="truncate">{emp.displayName}</span>
                                <span className="text-[11px] text-[var(--color-fg-subtle)] font-mono truncate">
                                  {emp.username}
                                </span>
                              </div>
                            </TD>
                            <TD className="text-right num font-mono text-[var(--color-fg)]">
                              {fmt(emp.cap)}
                            </TD>
                            <TD className="text-right num font-mono text-[var(--color-success)]">
                              {fmt(emp.remaining)}
                            </TD>
                            <TD>
                              <div className="flex items-center gap-2 min-w-[80px]">
                                <div className="h-1.5 flex-1 rounded-full bg-[var(--color-bg)] overflow-hidden">
                                  <div
                                    className="h-full rounded-full"
                                    style={{
                                      width: `${pct}%`,
                                      background: nearFull
                                        ? 'var(--color-warning)'
                                        : 'var(--color-success)',
                                    }}
                                  />
                                </div>
                                <span className="text-[10px] font-mono text-[var(--color-fg-subtle)] tabular-nums w-8 text-right">
                                  {pct.toFixed(0)}%
                                </span>
                              </div>
                            </TD>
                            <TD className="text-right">
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setCapEditing(emp)}
                              >
                                Editar
                              </Button>
                            </TD>
                          </TR>
                        );
                      })}
                    </TBody>
                  </Table>
                </div>
              )}
            </div>
          )}

          {/* Topes de apuesta */}
          <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius)] p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-lg tracking-tight text-[var(--color-fg)] flex items-center gap-2">
                <Gauge className="size-4 text-[var(--color-warning)]" />
                Topes de apuesta
              </h2>
              {canEditCaps && (
                <Button variant="secondary" size="sm" onClick={() => setCapsOpen(true)}>
                  Editar topes
                </Button>
              )}
            </div>
            <p className="text-[12px] text-[var(--color-fg-muted)] leading-relaxed">
              Limitan el volumen apostado por mes. Al superarse, las apuestas se{' '}
              <strong>bloquean</strong> — protege contra que un bug o un fraude te
              genere deuda con el proveedor.
            </p>
            {caps.isLoading ? (
              <Skeleton className="h-32" />
            ) : caps.isError || !caps.data ? (
              <EmptyState hint="data" label="No se pudieron cargar los topes." />
            ) : (
              <div className="flex flex-col gap-2">
                <CapRow
                  label="Tope por jugador / mes"
                  value={
                    caps.data.caps.playerMonthly === 0
                      ? null
                      : fmt(String(caps.data.caps.playerMonthly))
                  }
                />
                <CapRow
                  label="Tope global / mes"
                  value={
                    caps.data.caps.globalMonthly === 0
                      ? null
                      : fmt(String(caps.data.caps.globalMonthly))
                  }
                />
                <CapRow
                  label="Apostado este mes (global)"
                  value={fmt(caps.data.turnover.global)}
                  accent
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Detalle de fondeos (colapsable) ─── */}
      {!notProvisioned &&
        injections.data &&
        injections.data.injections.length > 0 && (
          <CollapsibleCard title="Detalle de fondeos" defaultOpen={false}>
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>Fecha</TH>
                    <TH>Tipo</TH>
                    <TH className="text-right">Monto</TH>
                    <TH className="hidden sm:table-cell">Motivo</TH>
                    <TH className="hidden md:table-cell">Notas</TH>
                  </TR>
                </THead>
                <TBody>
                  {injections.data.injections.map((inj) => (
                    <TR key={inj.id}>
                      <TD className="num text-[11px] text-[var(--color-fg-muted)] whitespace-nowrap">
                        {new Date(inj.createdAt).toLocaleString('es-AR', {
                          timeZone: 'America/Argentina/Buenos_Aires',
                          day: '2-digit',
                          month: '2-digit',
                          year: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </TD>
                      <TD>
                        <Badge variant={inj.type === 'capital' ? 'success' : 'info'}>
                          {inj.type === 'capital' ? 'Capital' : 'Presupuesto'}
                        </Badge>
                      </TD>
                      <TD className="text-right num font-mono text-[var(--color-success)] whitespace-nowrap">
                        +{fmt(inj.amount)}
                      </TD>
                      <TD className="hidden sm:table-cell text-[12px] text-[var(--color-fg)]">
                        {inj.reason}
                      </TD>
                      <TD className="hidden md:table-cell text-[12px] text-[var(--color-fg-muted)]">
                        {inj.notes ?? '—'}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          </CollapsibleCard>
        )}

      <InjectBudgetModal open={budgetOpen} onOpenChange={setBudgetOpen} />
      {capEditing && (
        <EditCorrectionCapModal
          open={!!capEditing}
          onOpenChange={(o) => !o && setCapEditing(null)}
          userId={capEditing.userId}
          username={capEditing.username}
          currentCap={capEditing.cap}
        />
      )}
      <AssignEmployeeCapModal open={assignCapOpen} onOpenChange={setAssignCapOpen} />
      <EditBettingCapsModal
        open={capsOpen}
        onOpenChange={setCapsOpen}
        current={caps.data}
      />
    </PageShell>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Helpers de UI
// ──────────────────────────────────────────────────────────────────────

/** Tarjetón del presupuesto mensual de minteo: tope / creadas / disponible + barra. */
function MintBudgetCard({
  monthly,
  minted,
  available,
}: {
  monthly: string;
  minted: string;
  available: string;
}) {
  const monthlyNum = Number(monthly);
  // Sin tope configurado (valor centinela alto).
  if (monthlyNum >= 1e11) {
    return (
      <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-accent-border)] rounded-[var(--radius)] p-5 flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-semibold flex items-center gap-1.5">
          <Coins className="size-3.5 text-[var(--color-accent-text)]" />
          Presupuesto para crear fichas
        </span>
        <span className="text-lg text-[var(--color-fg)]">Sin tope configurado</span>
        <span className="text-[11px] text-[var(--color-fg-subtle)] mt-1">
          Configuralo en Ajustes (
          <span className="font-mono">treasury.monthly_mint_budget</span>). Usado
          este mes: <span className="font-mono">{fmt(minted)}</span>.
        </span>
      </div>
    );
  }
  const mintedNum = Number(minted);
  const pct =
    monthlyNum > 0 ? Math.min(100, Math.max(0, (mintedNum / monthlyNum) * 100)) : 0;
  const nearFull = pct >= 90;
  return (
    <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-accent-border)] rounded-[var(--radius)] p-5 flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MintStat label="Tope del mes" value={fmt(monthly)} />
        <MintStat label="Creadas este mes" value={fmt(minted)} muted />
        <MintStat
          label="Disponible"
          value={fmt(available)}
          tone={nearFull ? 'warning' : 'success'}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="h-2 w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-[width]"
            style={{
              width: `${pct}%`,
              background: nearFull ? 'var(--color-warning)' : 'var(--color-accent)',
            }}
          />
        </div>
        <span className="text-[11px] text-[var(--color-fg-subtle)]">
          {pct.toFixed(1)}% del tope usado este mes. Para pasarlo hay que marcar{' '}
          <strong>Fondeo</strong> al crear las fichas.
        </span>
      </div>
    </div>
  );
}

function MintStat({
  label,
  value,
  muted,
  tone,
}: {
  label: string;
  value: string;
  muted?: boolean;
  tone?: 'success' | 'warning';
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-semibold">
        {label}
      </span>
      <span
        className={cn(
          'text-[1.4rem] font-mono leading-none tabular-nums',
          tone === 'warning'
            ? 'text-[var(--color-warning)]'
            : tone === 'success'
              ? 'text-[var(--color-success)]'
              : muted
                ? 'text-[var(--color-fg-muted)]'
                : 'text-[var(--color-fg)]',
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** Fila de un tope de apuesta. */
function CapRow({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | null;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-[var(--radius-sm)] bg-[var(--color-bg)]">
      <span className="text-[12.5px] text-[var(--color-fg-muted)]">{label}</span>
      {value === null ? (
        <span className="text-[12px] text-[var(--color-fg-subtle)]">sin tope</span>
      ) : (
        <span
          className={cn(
            'font-mono text-[14px] tabular-nums whitespace-nowrap',
            accent ? 'text-[var(--color-accent-text)]' : 'text-[var(--color-fg)]',
          )}
        >
          {value}
        </span>
      )}
    </div>
  );
}
