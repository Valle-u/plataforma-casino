/**
 * /tesoreria — La Casa / tesorería (Blindaje del núcleo económico, Parte B).
 *
 * Una sección MÁS del panel de admin (no es una app aparte ni un login aparte):
 * el admin administra desde acá la cuenta "Casa", que es la única fuente de
 * fichas y la contraparte de todo (depósitos, juego, premios).
 *
 * B-build-1b: muestra el estado de la Casa (balance + bloqueado) y explica qué
 * es. Las piezas que faltan (aporte de capital, GGR, exposición, respaldo) se
 * van sumando a esta pantalla en B-build-2..6.
 *
 * Permiso: house.view. Solo admin_tenant.
 */

'use client';

import {
  Coins,
  Dices,
  Gauge,
  Plus,
  ShieldAlert,
  Sprout,
  TrendingUp,
  UserCog,
  Vault,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { HelpNote } from '@/components/ui/help-note';
import { PageHeader } from '@/components/ui/page-header';
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
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
import { CapitalNeededWidget } from '@/components/admin/capital-needed-widget';
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

const ROADMAP: { icon: typeof Sprout; label: string; phase: string }[] = [
  { icon: Dices, label: 'Juego con la Casa (bet → Casa, win ← Casa) + topes de apuesta', phase: 'B-build-4' },
  { icon: Coins, label: 'Premiaciones desde la Casa (comisiones, bonos, promos)', phase: 'B-build-5' },
  { icon: ShieldAlert, label: 'Invariante de respaldo (fichas ≤ plata real)', phase: 'B-build-6' },
];

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

  return (
    <PageShell className="max-w-[1100px]">

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
        <span className="block">
          La <strong>Casa</strong> es la caja del casino. Es especial: es la{' '}
          <strong>única cuenta que puede crear fichas nuevas</strong>, y es la
          contraparte de todo lo que pasa. Cuando un jugador deposita, la Casa le
          emite fichas (respaldadas por la transferencia que entró); cuando
          apuesta, las fichas vuelven a la Casa; cuando gana, salen de la Casa.
        </span>
        <span className="block mt-2">
          Para <strong>crear fichas</strong> usás{' '}
          <strong>“Fondear presupuesto”</strong>. No podés crear infinitas: hay
          un <strong>tope por mes</strong> (salvo que marques “Fondeo”, para casos
          puntuales). Acá también ves el <strong>saldo de la Casa</strong> y su
          evolución, los <strong>cupos</strong> de los empleados (cuánto pueden
          cargar por corrección al mes) y los <strong>topes de apuesta</strong>{' '}
          (para que un bug o un fraude no te generen deuda con el proveedor).
        </span>
      </HelpNote>

      {/* ─── Banner de bankroll ─── */}
      {!notProvisioned && (
        <StockAlertBanner
          operatorUserId={operatorUserId}
          showInjectCta={!indepMode && canInject}
        />
      )}

      {/* ─── KPIs de la Casa ─── */}
      {house.isLoading ? (
        <Skeleton className="h-32" />
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-px">
          <StatTile
            label="Balance total"
            value={fmtKpi(house.data.balance)}
            hint="Fichas en la Casa"
          />
          <StatTile
            label="Bloqueado"
            value={fmtKpi(house.data.lockedBalance)}
            hint="En holds / retiros"
          />
          <StatTile
            label="Disponible"
            value={fmtKpi(String(Number(house.data.balance) - Number(house.data.lockedBalance)))}
            variant={stockAlert.data?.level === 'critical' ? 'accent' : 'default'}
            hint={stockAlert.data ? (stockAlert.data.level === 'ok' ? 'Saludable' : stockAlert.data.level === 'low' ? 'Bajo' : 'Crítico') : undefined}
          />
          <StatTile
            label="Fichas creadas / mes"
            value={mintBudget.data ? fmtKpi(mintBudget.data.mintedThisMonth) : '...'}
            hint={mintBudget.data ? `Tope ${fmtKpi(mintBudget.data.monthlyBudget)}` : undefined}
          />
          <StatTile
            label="Disponible del tope"
            value={mintBudget.data ? fmtKpi(mintBudget.data.available) : '...'}
          />
        </div>
      )}

      {/* ─── Gráficas ─── */}
      {!notProvisioned && (
        <section className="flex flex-col gap-3">
          <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium flex items-center gap-2">
            <TrendingUp className="size-3" />
            Gráficas
          </span>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Evolución del balance */}
            <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] p-4 flex flex-col gap-3">
              <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
                Evolución del balance · 30 días
              </span>
              {balanceHistory.isLoading ? (
                <Skeleton className="h-[200px]" />
              ) : balanceHistory.isError || !balanceHistory.data?.history ? (
                <div className="h-[200px] flex items-center justify-center text-xs text-[var(--color-fg-subtle)]">
                  No se pudo cargar el historial
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
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
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(d: string) => {
                        const dt = new Date(d + 'T00:00:00');
                        return dt.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: 'numeric', month: 'short' });
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
                      strokeWidth={1.5}
                      fill="url(#balance-grad)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Fondeos por mes */}
            <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] p-4 flex flex-col gap-3">
              <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
                Fondeos por mes
              </span>
              {injections.isLoading ? (
                <Skeleton className="h-[200px]" />
              ) : injections.isError || !injections.data ? (
                <div className="h-[200px] flex items-center justify-center text-xs text-[var(--color-fg-subtle)]">
                  No se pudieron cargar los fondeos
                </div>
              ) : monthlyInjections.length === 0 ? (
                <div className="h-[200px] flex items-center justify-center text-xs text-[var(--color-fg-subtle)]">
                  Sin fondeos aún
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart
                    data={monthlyInjections}
                    margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
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
                      fill="var(--color-success)"
                      radius={[2, 2, 0, 0]}
                      barSize={28}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ─── Capital necesario ─── */}
      {!notProvisioned && (
        <CapitalNeededWidget
          operatorUserId={operatorUserId}
          defaultDays={30}
          title={indepMode ? 'Drenaje de tu sub-red' : 'Capital necesario'}
        />
      )}

      {/* ─── Presupuesto mensual de minteo ─── */}
      {!notProvisioned && (
        <section className="flex flex-col gap-2">
          <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium flex items-center gap-2">
            <Coins className="size-3" />
            Presupuesto mensual para crear fichas
          </span>
          {mintBudget.isLoading ? (
            <Skeleton className="h-24" />
          ) : mintBudget.isError || !mintBudget.data ? (
            <EmptyState
              hint="data"
              label="No se pudo cargar el presupuesto mensual de minteo."
            />
          ) : Number(mintBudget.data.monthlyBudget) >= 1e11 ? (
            <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] border-l-2 border-l-[var(--color-accent)] p-5 flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] flex items-center gap-1.5">
                <Coins className="size-3.5" />
                Tope del mes
              </span>
              <span className="text-lg sm:text-[1.25rem] leading-tight text-[var(--color-fg)]">
                Sin tope configurado
              </span>
              <span className="text-[11px] text-[var(--color-fg-subtle)] mt-1">
                Configuralo en Ajustes (
                <span className="font-mono">treasury.monthly_mint_budget</span>
                ). Usado este mes:{' '}
                <span className="font-mono">
                  {fmt(mintBudget.data.mintedThisMonth)}
                </span>
                .
              </span>
            </div>
          ) : (
            (() => {
              const monthly = Number(mintBudget.data.monthlyBudget);
              const minted = Number(mintBudget.data.mintedThisMonth);
              const pct =
                monthly > 0
                  ? Math.min(100, Math.max(0, (minted / monthly) * 100))
                  : 0;
              const nearFull = pct >= 90;
              return (
                <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] border-l-2 border-l-[var(--color-accent)] p-5 flex flex-col gap-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
                        Tope del mes
                      </span>
                      <span className="text-lg sm:text-[1.4rem] font-mono num leading-none text-[var(--color-fg)]">
                        {fmt(mintBudget.data.monthlyBudget)}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
                        Creadas este mes
                      </span>
                      <span className="text-lg sm:text-[1.4rem] font-mono num leading-none text-[var(--color-fg-muted)]">
                        {fmt(mintBudget.data.mintedThisMonth)}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
                        Disponible
                      </span>
                      <span
                        className={`text-lg sm:text-[1.4rem] font-mono num leading-none ${
                          nearFull
                            ? 'text-[var(--color-warning)]'
                            : 'text-[var(--color-success)]'
                        }`}
                      >
                        {fmt(mintBudget.data.available)}
                      </span>
                    </div>
                  </div>
                  {/* Barra de progreso */}
                  <div className="flex flex-col gap-1.5">
                    <div className="h-2 w-full bg-[var(--color-bg)] border border-[var(--color-border)] overflow-hidden">
                      <div
                        className={`h-full transition-[width] ${
                          nearFull
                            ? 'bg-[var(--color-warning)]'
                            : 'bg-[var(--color-accent)]'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-[var(--color-fg-subtle)]">
                      {pct.toFixed(1)}% del tope usado este mes. Para pasarlo hay
                      que marcar <strong>Fondeo</strong> al crear las fichas.
                    </span>
                  </div>
                </div>
              );
            })()
          )}
        </section>
      )}

      {/* ─── Fondeos de la Casa (tabla) ─── */}
      <section className="flex flex-col gap-2">
        <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium flex items-center gap-2">
          <Sprout className="size-3" />
          Fondeos de la Casa
        </span>
        {injections.isLoading ? (
          <Skeleton className="h-24" />
        ) : injections.isError || !injections.data ? (
          <EmptyState hint="data" label="No se pudo cargar el historial de fondeos." />
        ) : injections.data.injections.length === 0 ? (
          <EmptyState
            hint="data"
            label={'Todavía no hay fondeos. Usá "Fondear presupuesto" para arrancar.'}
          />
        ) : (
          <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto">
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
        )}
      </section>

      {/* ─── Cupos de empleados ─── */}
      {canEditCap && (
        <section className="flex flex-col gap-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium flex items-center gap-2">
              <UserCog className="size-3" />
              Cupos de empleados
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setAssignCapOpen(true)}
              className="self-start sm:self-auto"
            >
              <Plus className="size-3" />
              Asignar cupo
            </Button>
          </div>
          <p className="text-[12px] text-[var(--color-fg-muted)]">
            Empleados con permiso para hacer{' '}
            <strong>cargas por corrección / bonificación / reintegro</strong> a
            clientes. El cupo es un techo mensual: se resetea el 1° de cada mes.
          </p>
          {employees.isLoading ? (
            <Skeleton className="h-24" />
          ) : employees.isError || !employees.data ? (
            <EmptyState hint="data" label="No se pudo cargar la lista de empleados." />
          ) : employees.data.employees.length === 0 ? (
            <EmptyState
              hint="data"
              label="Todavía no hay empleados con cupo configurado. Editá el cupo desde el detalle de un usuario o vía la API."
            />
          ) : (
            <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>Empleado</TH>
                    <TH className="text-right">Cupo / mes</TH>
                    <TH className="text-right">Usado</TH>
                    <TH className="text-right">Restante</TH>
                    <TH></TH>
                  </TR>
                </THead>
                <TBody>
                  {employees.data.employees.map((emp) => (
                    <TR key={emp.userId}>
                      <TD className="text-[12px] text-[var(--color-fg)]">
                        <div className="flex flex-col leading-tight">
                          <span>{emp.displayName}</span>
                          <span className="text-[11px] text-[var(--color-fg-subtle)] font-mono">
                            {emp.username}
                          </span>
                        </div>
                      </TD>
                      <TD className="text-right num font-mono text-[var(--color-fg)]">
                        {fmt(emp.cap)}
                      </TD>
                      <TD className="text-right num font-mono text-[var(--color-fg-muted)]">
                        {fmt(emp.used)}
                      </TD>
                      <TD className="text-right num font-mono text-[var(--color-success)]">
                        {fmt(emp.remaining)}
                      </TD>
                      <TD className="text-right">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setCapEditing(emp)}
                          className="min-w-[40px]"
                        >
                          Editar
                        </Button>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </section>
      )}

      {/* ─── Topes de apuesta ─── */}
      <section className="flex flex-col gap-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium flex items-center gap-2">
            <Gauge className="size-3" />
            Topes de apuesta (exposición)
          </span>
          {canEditCaps && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setCapsOpen(true)}
              className="self-start sm:self-auto"
            >
              Editar topes
            </Button>
          )}
        </div>
        {caps.isLoading ? (
          <Skeleton className="h-20" />
        ) : caps.isError || !caps.data ? (
          <EmptyState hint="data" label="No se pudieron cargar los topes." />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] p-3 flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)]">
                Tope por jugador / mes
              </span>
              <span className="text-[1.1rem] font-mono num leading-tight text-[var(--color-fg)]">
                {caps.data.caps.playerMonthly === 0 ? (
                  <span className="text-[13px] text-[var(--color-fg-subtle)]">
                    sin tope
                  </span>
                ) : (
                  fmt(String(caps.data.caps.playerMonthly))
                )}
              </span>
            </div>
            <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] p-3 flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)]">
                Tope global / mes
              </span>
              <span className="text-[1.1rem] font-mono num leading-tight text-[var(--color-fg)]">
                {caps.data.caps.globalMonthly === 0 ? (
                  <span className="text-[13px] text-[var(--color-fg-subtle)]">
                    sin tope
                  </span>
                ) : (
                  fmt(String(caps.data.caps.globalMonthly))
                )}
              </span>
            </div>
            <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] border-l-2 border-l-[var(--color-accent)] p-3 flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)]">
                Apostado este mes (global)
              </span>
              <span className="text-[1.1rem] font-mono num leading-tight text-[var(--color-accent-text)]">
                {fmt(caps.data.turnover.global)}
              </span>
            </div>
          </div>
        )}
        <p className="text-[11px] text-[var(--color-fg-subtle)]">
          Limitan el volumen apostado por mes (turnover). Al superarse, las
          apuestas se <strong>bloquean</strong> — protege contra que un bug o
          fraude te genere deuda con el proveedor externo.
        </p>
      </section>

      {/* ─── Roadmap ─── */}
      <section className="flex flex-col gap-2">
        <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium">
          Próximamente en esta pantalla
        </span>
        <div className="flex flex-col divide-y divide-[var(--color-border)] border border-[var(--color-border)]">
          {ROADMAP.map((r) => {
            const Icon = r.icon;
            return (
              <div
                key={r.phase}
                className="flex items-center gap-3 px-4 py-2.5 bg-[var(--color-bg-elevated)]"
              >
                <Icon className="size-4 text-[var(--color-fg-subtle)] shrink-0" />
                <span className="flex-1 text-[12px] text-[var(--color-fg-muted)]">
                  {r.label}
                </span>
                <Badge variant="neutral">Pronto</Badge>
              </div>
            );
          })}
        </div>
      </section>

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

      <AssignEmployeeCapModal
        open={assignCapOpen}
        onOpenChange={setAssignCapOpen}
      />
      <EditBettingCapsModal
        open={capsOpen}
        onOpenChange={setCapsOpen}
        current={caps.data}
      />
    </PageShell>
  );
}
