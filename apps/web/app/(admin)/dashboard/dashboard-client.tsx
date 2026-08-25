/**
 * /dashboard (Inicio) — pantalla inicial del operador.
 *
 * Rediseño 2026-08 (handoff design_handoff_panel_control): composición de la
 * maqueta — fila de 6 KPIs, "Operativa de hoy", gráfico de saldo de la Casa y
 * actividad reciente. Todo con datos que YA existen (frontend puro).
 *
 * Gaps del handoff resueltos (decisión del dueño):
 *   - "Jugando ahora" (no hay contador online) → "Activos (24h)" (por login).
 *   - "Flujo de caja 30d" (no hay serie diaria dep/ret/netwin sin backend) →
 *     serie real que sí existe: saldo de la Casa a 30 días.
 */

'use client';

import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  Clock,
  Landmark,
  LayoutDashboard,
  RefreshCw,
  TrendingUp,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  memo,
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
  type SVGProps,
} from 'react';
import { StockAlertBanner } from '@/components/admin/stock-alert-banner';
import { Button } from '@/components/ui/button';
import { HelpNote } from '@/components/ui/help-note';
import { KpiTile } from '@/components/ui/kpi-tile';
import { PageHeader } from '@/components/ui/page-header';
import { PageShell } from '@/components/ui/page-shell';
import {
  hasPermission,
  isAdminTenant,
  isIndependentBranch,
  operatorAudience,
  useAuth,
} from '@/lib/auth-context';
import {
  arStartOfCurrentMonthIso,
  arStartOfDayIso,
  arTodayDateStr,
} from '@/lib/format-date';
import { useDeposits } from '@/lib/hooks/use-deposits';
import { useHouseBalanceHistory } from '@/lib/hooks/use-house';
import { useUsersStats } from '@/lib/hooks/use-users';
import {
  TX_TYPE_LABELS,
  useWalletStatsMovements,
  useWalletStatsScopedAudit,
  useWalletStatsSummary,
  type MovementRow,
} from '@/lib/hooks/use-wallet-stats';
import { useWithdrawals } from '@/lib/hooks/use-withdrawals';

function money(s: string | number | null | undefined): string {
  const n = Number(s ?? 0);
  if (Number.isNaN(n)) return '—';
  return '$' + n.toLocaleString('es-AR', { maximumFractionDigits: 0 });
}

// recharts es pesado (~170 kB): lo cargamos aparte para que no pese en la
// primera carga de la landing del admin. Se baja recién al renderizar el chart.
const HouseBalanceChart = dynamic(() => import('./house-balance-chart'), {
  ssr: false,
  loading: () => <ChartSkeleton />,
});

export default function DashboardClient() {
  const { user } = useAuth();
  const adminMode = isAdminTenant(user);
  const indepMode = isIndependentBranch(user);
  // Audiencia: solo para adaptar el copy de ayuda (admin ve la Casa/tenant;
  // el operador ve su red). No afecta gating ni datos.
  const audience = operatorAudience(user);

  const canDeposits =
    adminMode || hasPermission(user, 'deposits.view') || hasPermission(user, 'deposits.view_all');
  const canMoney = hasPermission(user, 'wallet_stats.view_any');
  // Socio/distribuidor: ven los números de SU red (view_own_network). El
  // backend auto-scopea a su downstream. Los operativos (cajero/empleado)
  // no tienen stats agregados → su Inicio se enfoca en lo operativo.
  const canOwnNetwork = hasPermission(user, 'wallet_stats.view_own_network');
  const showActivity = canMoney || canOwnNetwork;
  const canHouse = hasPermission(user, 'house.view');
  const canInject = hasPermission(user, 'house.inject_capital');

  const monthStart = arStartOfCurrentMonthIso();
  const todayStart = arStartOfDayIso(arTodayDateStr());

  // Datos.
  const usersStats = useUsersStats();
  const monthAudit = useWalletStatsScopedAudit(
    { scope: 'platform', dateFrom: monthStart },
    canMoney,
  );
  const todayAudit = useWalletStatsScopedAudit(
    { scope: 'platform', dateFrom: todayStart },
    canMoney,
  );
  // Resumen de la red propia (socio/distribuidor). Auto-scopeado por el
  // backend a su downstream; solo se pide cuando NO es admin con view_any.
  const ownSummary = useWalletStatsSummary(
    { dateFrom: monthStart },
    canOwnNetwork && !canMoney,
  );
  const depPendingQ = useDeposits({ status: ['pending'], limit: 1 });
  const wdPendingQ = useWithdrawals({ status: ['pending'], limit: 1 });
  const depTodayQ = useDeposits({ fromDate: todayStart, limit: 1 });
  const wdTodayQ = useWithdrawals({ fromDate: todayStart, limit: 1 });
  const houseHist = useHouseBalanceHistory(30);
  const movements = useWalletStatsMovements({ limit: 8 });

  const opsToday = (depTodayQ.data?.total ?? 0) + (wdTodayQ.data?.total ?? 0);
  const pendTotal = (depPendingQ.data?.total ?? 0) + (wdPendingQ.data?.total ?? 0);

  const showBankrollBanner = (adminMode || indepMode) && canHouse;
  const bankrollOperatorId = indepMode ? (user?.id ?? null) : null;

  const handleRefresh = () => {
    void usersStats.refetch();
    void monthAudit.refetch();
    void todayAudit.refetch();
    void depPendingQ.refetch();
    void wdPendingQ.refetch();
    void depTodayQ.refetch();
    void wdTodayQ.refetch();
    void houseHist.refetch();
    void movements.refetch();
    void ownSummary.refetch();
  };

  return (
    <PageShell className="gap-4">
      <PageHeader
        icon={LayoutDashboard}
        title="Inicio"
        description={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>Cómo viene la operación este mes.</span>
            <span className="inline-flex items-center gap-1.5 text-[var(--color-fg-subtle)]">
              <ClockBadge /> hora de Argentina
            </span>
          </span>
        }
        actions={
          <>
            <Button variant="secondary" size="md" onClick={handleRefresh}>
              <RefreshCw className="size-3.5" />
              Actualizar
            </Button>
            {canDeposits && (
              <Button variant="primary" size="md" asChild>
                <Link href="/deposits">
                  <ArrowDownToLine className="size-3.5" />
                  Aprobar depósitos
                </Link>
              </Button>
            )}
          </>
        }
      />

      <HelpNote id="dashboard">
        {audience === 'admin' ? (
          <>
            Esta es la pantalla de inicio: un vistazo general de la operación del
            tenant. Arriba, los <strong>números del mes</strong> y la{' '}
            <strong>operativa de hoy</strong>; más abajo, cómo evolucionó el{' '}
            <strong>saldo de la Casa</strong> y la{' '}
            <strong>actividad reciente</strong>. Todo lo que hacés queda registrado
            en Registro de actividad.
          </>
        ) : audience === 'independent' ? (
          <>
            Esta es la pantalla de inicio: un vistazo general de tu operación.
            Arriba, los <strong>números de tu red</strong> y la{' '}
            <strong>operativa de hoy</strong>; más abajo, cómo evolucionó el{' '}
            <strong>saldo de tu banca</strong> y la{' '}
            <strong>actividad reciente</strong>. Todo lo que hacés queda registrado
            en Registro de actividad.
          </>
        ) : (
          <>
            Esta es la pantalla de inicio: un vistazo general de tu red. Arriba, los{' '}
            <strong>números de tu red</strong> y la{' '}
            <strong>operativa de hoy</strong>; más abajo, la{' '}
            <strong>actividad reciente</strong> de tus jugadores. Todo lo que hacés
            queda registrado en Registro de actividad.
          </>
        )}
      </HelpNote>

      {showBankrollBanner && (
        <StockAlertBanner
          operatorUserId={bankrollOperatorId}
          showInjectCta={adminMode && canInject}
          compact
        />
      )}

      {/* ── 6 KPIs del mes ────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiTile
          label="Usuarios totales"
          icon={Users}
          value={usersStats.data?.total ?? '—'}
          hint={
            usersStats.data
              ? `${usersStats.data.byStatus.active ?? 0} activos`
              : 'cargando…'
          }
        />
        <KpiTile
          label="Activos (24h)"
          icon={Activity}
          tone="accent"
          value={usersStats.data?.activeLast24h ?? '—'}
          hint="entraron hoy"
        />
        {canMoney && (
          <>
            <KpiTile
              label="Depósitos del mes"
              icon={ArrowDownToLine}
              tone="success"
              value={money(monthAudit.data?.plata.depositos)}
              hint="plata que entró"
            />
            <KpiTile
              label="Retiros del mes"
              icon={ArrowUpFromLine}
              tone="danger"
              value={money(monthAudit.data?.plata.retiros)}
              hint="plata que salió"
            />
            <KpiTile
              label="Neto del mes"
              icon={Landmark}
              value={money(monthAudit.data?.plata.neto)}
              hint="entró − salió"
            />
            <KpiTile
              label="Netwin del mes"
              icon={TrendingUp}
              tone="info"
              value={money(monthAudit.data?.juego.netwin)}
              hint="apostado − premios"
            />
          </>
        )}
        {canOwnNetwork && !canMoney && (
          <>
            <KpiTile
              label="Entró a tu red (mes)"
              icon={ArrowDownToLine}
              tone="success"
              value={money(ownSummary.data?.totalIn)}
              hint="fichas que entraron"
            />
            <KpiTile
              label="Salió de tu red (mes)"
              icon={ArrowUpFromLine}
              tone="danger"
              value={money(ownSummary.data?.totalOut)}
              hint="fichas que salieron"
            />
            <KpiTile
              label="Neto de tu red (mes)"
              icon={Landmark}
              value={money(ownSummary.data?.net)}
              hint="entró − salió"
            />
            <KpiTile
              label="Movimientos (mes)"
              icon={Activity}
              value={ownSummary.data?.txCount ?? '—'}
              hint="en tu red"
            />
          </>
        )}
      </div>

      {/* ── Operativa de hoy ──────────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <SectionTitle icon={Activity}>Operativa de hoy</SectionTitle>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {canMoney && (
            <>
              <KpiTile
                label="Depósitos hoy"
                icon={ArrowDownToLine}
                tone="success"
                value={money(todayAudit.data?.plata.depositos)}
              />
              <KpiTile
                label="Retiros hoy"
                icon={ArrowUpFromLine}
                tone="danger"
                value={money(todayAudit.data?.plata.retiros)}
              />
            </>
          )}
          <KpiTile
            label="Operaciones"
            icon={Activity}
            value={opsToday}
            hint="depósitos + retiros de hoy"
          />
          <KpiTile
            label="Pendientes"
            icon={Clock}
            tone="warning"
            value={pendTotal}
            hint="por aprobar"
          />
        </div>
      </section>

      {/* ── Saldo de la Casa + Actividad reciente ─────────────── */}
      {canHouse && (
        <Card>
          <CardHeader
            title="Saldo de la Casa · 30 días"
            hint="Cómo evolucionó el saldo de fichas de la Casa."
          />
          {houseHist.data?.history && houseHist.data.history.length > 0 ? (
            <HouseBalanceChart data={houseHist.data.history} />
          ) : (
            <ChartSkeleton />
          )}
        </Card>
      )}

      {showActivity && (
        <Card>
          <div className="flex items-center justify-between gap-3">
            <CardHeader title="Actividad reciente" hint="Los últimos movimientos de fichas." />
            <Link
              href="/wallet-stats"
              className="text-[12px] text-[var(--color-accent-text)] hover:underline shrink-0 inline-flex items-center gap-1"
            >
              Ver todo <ArrowRight className="size-3.5" />
            </Link>
          </div>
          {movements.data?.data && movements.data.data.length > 0 ? (
            <div className="flex flex-col divide-y divide-[var(--color-border)]">
              {movements.data.data.map((m) => (
                <ActivityRow key={m.id} m={m} />
              ))}
            </div>
          ) : movements.isLoading ? (
            <div className="py-8 text-center text-[12px] text-[var(--color-fg-subtle)]">
              Cargando actividad…
            </div>
          ) : (
            <div className="py-8 text-center text-[12px] text-[var(--color-fg-subtle)]">
              Todavía no hay movimientos.
            </div>
          )}
        </Card>
      )}
    </PageShell>
  );
}

// ── Sub-componentes ─────────────────────────────────────────────

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius)] p-4 flex flex-col gap-3">
      {children}
    </div>
  );
}

function CardHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[13px] font-semibold text-[var(--color-fg)]">{title}</span>
      {hint && <span className="text-[11px] text-[var(--color-fg-subtle)]">{hint}</span>}
    </div>
  );
}

function SectionTitle({
  icon: Icon,
  children,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-4 text-[var(--color-accent-text)]" />
      <span className="text-[13px] font-semibold text-[var(--color-fg)]">{children}</span>
    </div>
  );
}

function ActivityRow({ m }: { m: MovementRow }) {
  const isIn = m.direction === 'in';
  const who = m.ownerDisplayName || (m.ownerUsername ? `@${m.ownerUsername}` : '—');
  const what = TX_TYPE_LABELS[m.type] ?? m.type;
  return (
    <div className="flex items-center gap-3 py-2.5">
      <span
        className="size-2 rounded-full shrink-0"
        style={{ background: isIn ? 'var(--color-success)' : 'var(--color-danger)' }}
        aria-hidden
      />
      <div className="flex-1 min-w-0">
        <span className="text-[13px] text-[var(--color-fg)]">{who}</span>
        <span className="text-[12px] text-[var(--color-fg-muted)]"> · {what}</span>
      </div>
      <span
        className={`text-[12.5px] font-mono tabular-nums shrink-0 ${
          isIn ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'
        }`}
      >
        {isIn ? '+' : '−'}
        {money(m.amount)}
      </span>
      <span className="text-[11px] font-mono text-[var(--color-fg-subtle)] shrink-0 w-10 text-right">
        {shortTime(m.createdAt)}
      </span>
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="h-[220px] flex items-center justify-center text-[12px] text-[var(--color-fg-subtle)]">
      Cargando gráfico…
    </div>
  );
}

function shortTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

/** Reloj aislado — re-renderiza solo a sí mismo cada segundo. */
const ClockBadge = memo(function ClockBadge() {
  const fmt = () =>
    new Date().toLocaleTimeString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  // Arranca vacío para que el render del servidor y la hidratación coincidan
  // (la hora del server ≠ la del cliente causaría hydration mismatch). Se
  // completa recién en el efecto (solo cliente).
  const [time, setTime] = useState('');
  useEffect(() => {
    setTime(fmt());
    const id = setInterval(() => setTime(fmt()), 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="font-mono text-[var(--color-accent-text)]">{time}</span>;
});
