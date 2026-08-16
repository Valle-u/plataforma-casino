/**
 * /dashboard (Inicio) — pantalla inicial del operador.
 *
 * Rediseño 2026-08-16 ("panel amigable"): compacto (grid, menos scroll),
 * orientado a la ACCIÓN (trabajo pendiente arriba) y con gráficos didácticos.
 * Todo con datos que YA existen (frontend puro, sin tocar backend).
 */

'use client';

import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  CheckCircle2,
  Coins,
  Fingerprint,
  Landmark,
  LayoutDashboard,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { memo, useEffect, useState, type ComponentType, type SVGProps } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from 'recharts';
import { StockAlertBanner } from '@/components/admin/stock-alert-banner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { HelpNote } from '@/components/ui/help-note';
import { PageHeader } from '@/components/ui/page-header';
import { PageShell } from '@/components/ui/page-shell';
import { StatTile } from '@/components/ui/stat-tile';
import {
  hasPermission,
  isAdminTenant,
  isIndependentBranch,
  useAuth,
} from '@/lib/auth-context';
import { arStartOfCurrentMonthIso } from '@/lib/format-date';
import { useBankTransactions } from '@/lib/hooks/use-bank-transactions';
import { useDashboardStats } from '@/lib/hooks/use-dashboard-stats';
import { useDeposits } from '@/lib/hooks/use-deposits';
import { useHouseBalanceHistory } from '@/lib/hooks/use-house';
import { useWalletStatsScopedAudit } from '@/lib/hooks/use-wallet-stats';
import { useWithdrawals } from '@/lib/hooks/use-withdrawals';

function money(s: string | number | null | undefined): string {
  const n = Number(s ?? 0);
  if (Number.isNaN(n)) return '—';
  return '$' + n.toLocaleString('es-AR', { maximumFractionDigits: 0 });
}

function firstName(full: string): string {
  return full.split(/\s+/)[0] || full;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const stats = useDashboardStats();
  const adminMode = isAdminTenant(user);
  const indepMode = isIndependentBranch(user);

  const canDeposits =
    adminMode || hasPermission(user, 'deposits.view') || hasPermission(user, 'deposits.view_all');
  const canWithdrawals =
    adminMode || hasPermission(user, 'withdrawals.view') || hasPermission(user, 'withdrawals.view_all');
  const canBankTx = hasPermission(user, 'bank_tx.view');
  const canFraud =
    adminMode || hasPermission(user, 'fraud.view') || hasPermission(user, 'fraud.review');
  const canMoney = hasPermission(user, 'wallet_stats.view_any');
  const canHouse = hasPermission(user, 'house.view');

  // Trabajo pendiente (los listados devuelven `total`; pedimos limit=1).
  const depPending = useDeposits({ status: ['pending'], limit: 1 }).data?.total ?? 0;
  const wdPending = useWithdrawals({ status: ['pending'], limit: 1 }).data?.total ?? 0;
  const txUnmatched =
    useBankTransactions({ status: 'unmatched', limit: 1 }).data?.total ?? 0;

  // Plata del mes (entró/salió/netwin) — plataforma completa.
  const audit = useWalletStatsScopedAudit(
    { scope: 'platform', dateFrom: arStartOfCurrentMonthIso() },
    canMoney,
  );
  const balanceHistory = useHouseBalanceHistory(30);

  const showBankrollBanner = (adminMode || indepMode) && canHouse;
  const bankrollOperatorId = indepMode ? (user?.id ?? null) : null;
  const canInject = hasPermission(user, 'house.inject_capital');

  const pending: PendingItem[] = [
    canDeposits && {
      href: '/deposits',
      icon: ArrowDownToLine,
      label: 'Depósitos por aprobar',
      count: depPending,
    },
    canWithdrawals && {
      href: '/withdrawals',
      icon: ArrowUpFromLine,
      label: 'Retiros por aprobar',
      count: wdPending,
    },
    canBankTx && {
      href: '/bank-transactions',
      icon: Landmark,
      label: 'Transferencias sin conciliar',
      count: txUnmatched,
    },
    canFraud && {
      href: '/integrity',
      icon: Fingerprint,
      label: 'Cuentas por revisar',
      count: stats.fraud?.suspectedLinks ?? 0,
    },
  ].filter(Boolean) as PendingItem[];

  const totalPendiente = pending.reduce((a, p) => a + p.count, 0);

  return (
    <PageShell className="gap-5">
      <PageHeader
        icon={LayoutDashboard}
        title={`Buen día, ${firstName(user?.displayName ?? user?.username ?? 'Operador')}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>Un vistazo general de tu operación.</span>
            <span className="inline-flex items-center gap-1.5 text-[var(--color-fg-subtle)]">
              <ClockBadge /> hora de Argentina
            </span>
            {stats.hasError && (
              <Badge variant="danger" dot>
                Datos parciales
              </Badge>
            )}
          </span>
        }
        actions={
          <Button variant="primary" size="md" asChild>
            <Link href="/users">
              Ir a usuarios
              <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        }
      />

      <HelpNote id="dashboard">
        Esta es la pantalla de inicio. Arriba tenés lo que hay{' '}
        <strong>para hacer ahora</strong> (depósitos y retiros por aprobar,
        etc.). Abajo, los <strong>números del negocio</strong> con gráficos, y
        atajos a lo que más usás. Todo lo que hacés queda registrado en{' '}
        <strong>Registro de actividad</strong>.
      </HelpNote>

      {showBankrollBanner && (
        <StockAlertBanner
          operatorUserId={bankrollOperatorId}
          showInjectCta={adminMode && canInject}
          compact
        />
      )}

      {/* ── Para hacer ahora ──────────────────────────────────── */}
      {pending.length > 0 && (
        <section className="flex flex-col gap-2">
          <SectionTitle icon={CheckCircle2}>Para hacer ahora</SectionTitle>
          {totalPendiente === 0 ? (
            <div className="flex items-center gap-2 p-4 border border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[13px] text-[var(--color-fg-muted)]">
              <CheckCircle2 className="size-4 text-[var(--color-success)]" />
              Todo al día — no tenés nada pendiente. 🎉
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-[var(--color-border)]">
              {pending.map((p) => (
                <PendingCard key={p.href} {...p} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Números del negocio (gráficos) ────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-[var(--color-border)]">
        {/* Plata del mes */}
        {canMoney && (
          <ChartCard
            title="Plata este mes"
            hint="Cuánta plata real entró (depósitos) y salió (retiros)."
          >
            {audit.data ? (
              <div className="flex flex-col gap-3">
                <ResponsiveContainer width="100%" height={130}>
                  <BarChart
                    data={[
                      { name: 'Entró', value: Number(audit.data.plata.depositos) },
                      { name: 'Salió', value: Number(audit.data.plata.retiros) },
                    ]}
                    margin={{ top: 4, right: 4, left: 4, bottom: 0 }}
                  >
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 11, fill: 'var(--color-fg-muted)' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<MoneyTooltip />} cursor={{ fill: 'var(--color-bg-subtle)' }} />
                    <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={90}>
                      <Cell fill="var(--color-success)" />
                      <Cell fill="var(--color-danger)" />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="grid grid-cols-2 gap-px bg-[var(--color-border)]">
                  <MiniStat label="Neto (entró − salió)" value={money(audit.data.plata.neto)} />
                  <MiniStat label="Netwin del mes" value={money(audit.data.juego.netwin)} />
                </div>
              </div>
            ) : (
              <ChartSkeleton />
            )}
          </ChartCard>
        )}

        {/* La Casa (balance en el tiempo) — admin */}
        {canHouse && (
          <ChartCard
            title="La Casa — últimos 30 días"
            hint="Cómo evolucionó el saldo de fichas de la Casa."
          >
            {balanceHistory.data?.history && balanceHistory.data.history.length > 0 ? (
              <ResponsiveContainer width="100%" height={130}>
                <AreaChart
                  data={balanceHistory.data.history}
                  margin={{ top: 4, right: 4, left: 4, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="casaFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="date"
                    tickFormatter={shortDate}
                    tick={{ fontSize: 10, fill: 'var(--color-fg-subtle)' }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={24}
                  />
                  <Tooltip content={<MoneyTooltip labelFormatter={shortDate} />} />
                  <Area
                    type="monotone"
                    dataKey="balance"
                    stroke="var(--color-accent)"
                    strokeWidth={2}
                    fill="url(#casaFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <ChartSkeleton />
            )}
          </ChartCard>
        )}
      </div>

      {/* ── Resumen general + Atajos ──────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-px bg-[var(--color-border)]">
        {/* Resumen general */}
        <div className="bg-[var(--color-bg-elevated)] p-4 flex flex-col gap-3">
          <SectionTitle icon={TrendingUp}>Resumen general</SectionTitle>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-[var(--color-border)]">
            <StatTile
              label="Usuarios"
              value={stats.users?.total ?? '—'}
              hint={stats.users ? `${stats.users.active} activos` : 'cargando…'}
            />
            <StatTile
              label="Bonos activos"
              value={
                typeof stats.bonuses?.totalActive === 'number'
                  ? stats.bonuses.totalActive
                  : '—'
              }
              hint={
                typeof stats.bonuses?.totalRemainingChips === 'string'
                  ? `${stats.bonuses.totalRemainingChips} fichas`
                  : '—'
              }
            />
            <StatTile
              label="Cuentas sospechosas"
              value={stats.fraud?.suspectedLinks ?? '—'}
              variant={(stats.fraud?.suspectedLinks ?? 0) > 0 ? 'accent' : 'default'}
              hint={stats.fraud ? `${stats.fraud.confirmedLinks} confirmadas` : '—'}
            />
          </div>
        </div>

        {/* Atajos */}
        <div className="bg-[var(--color-bg-elevated)] p-4 flex flex-col gap-3">
          <SectionTitle icon={Activity}>Atajos</SectionTitle>
          <div className="flex flex-col gap-px bg-[var(--color-border)]">
            <QuickAction href="/users" icon={Users} title="Usuarios" hint="Ver y gestionar" />
            <QuickAction
              href="/wallet"
              icon={Coins}
              title="Mi billetera"
              hint="Cargar o transferir fichas"
            />
            <QuickAction
              href="/integrity"
              icon={(stats.fraud?.suspectedLinks ?? 0) > 0 ? ShieldAlert : ShieldCheck}
              title="Seguridad"
              hint="Integridad y fraude"
              danger={(stats.fraud?.suspectedLinks ?? 0) > 0}
            />
          </div>
        </div>
      </div>
    </PageShell>
  );
}

interface PendingItem {
  href: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  count: number;
}

function PendingCard({ href, icon: Icon, label, count }: PendingItem) {
  const active = count > 0;
  return (
    <Link
      href={href}
      className="group bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-subtle)] p-4 flex items-center gap-3 transition-colors border-l-2 border-l-transparent hover:border-l-[var(--color-accent)]"
    >
      <div
        className={`size-9 shrink-0 flex items-center justify-center border ${
          active
            ? 'border-[var(--color-accent-border)] bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)]'
            : 'border-[var(--color-border)] bg-[var(--color-bg-subtle)] text-[var(--color-fg-subtle)]'
        }`}
      >
        <Icon className="size-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-2xl font-display tabular-nums leading-none tracking-tight">
          {count}
        </div>
        <div className="text-[12px] text-[var(--color-fg-muted)] truncate mt-0.5">
          {label}
        </div>
      </div>
      <ArrowRight className="size-4 text-[var(--color-fg-subtle)] group-hover:text-[var(--color-fg-muted)] group-hover:translate-x-0.5 transition-all" />
    </Link>
  );
}

function SectionTitle({
  icon: Icon,
  children,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-4 text-[var(--color-accent-text)]" />
      <span className="text-[13px] font-semibold text-[var(--color-fg)]">{children}</span>
    </div>
  );
}

function ChartCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-[var(--color-bg-elevated)] p-4 flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-[13px] font-semibold text-[var(--color-fg)]">{title}</span>
        <span className="text-[11px] text-[var(--color-fg-subtle)]">{hint}</span>
      </div>
      {children}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--color-bg-elevated)] p-2.5 flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)]">
        {label}
      </span>
      <span className="text-[15px] font-display tabular-nums text-[var(--color-fg)]">
        {value}
      </span>
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="h-[130px] flex items-center justify-center text-[12px] text-[var(--color-fg-subtle)]">
      Cargando gráfico…
    </div>
  );
}

interface TooltipPayload {
  value: number;
  name?: string;
}
function MoneyTooltip({
  active,
  payload,
  label,
  labelFormatter,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string;
  labelFormatter?: (l: string) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2.5 py-1.5 text-[12px] shadow-lg">
      {label && (
        <div className="text-[var(--color-fg-subtle)] mb-0.5">
          {labelFormatter ? labelFormatter(label) : label}
        </div>
      )}
      <div className="font-display tabular-nums text-[var(--color-fg)]">
        {money(payload[0]!.value)}
      </div>
    </div>
  );
}

function shortDate(d: string): string {
  // 'YYYY-MM-DD' → 'DD/MM'
  const [, m, day] = d.split('-');
  return day && m ? `${day}/${m}` : d;
}

function QuickAction({
  href,
  icon: Icon,
  title,
  hint,
  danger,
}: {
  href: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  hint: string;
  danger?: boolean;
}) {
  return (
    <Link
      href={href}
      className="group bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-subtle)] p-2.5 flex items-center gap-2.5 transition-colors border-l-2 border-l-transparent hover:border-l-[var(--color-accent)]"
    >
      <div
        className={`size-8 shrink-0 border flex items-center justify-center ${
          danger
            ? 'border-[var(--color-danger)] bg-[var(--color-danger-bg)] text-[var(--color-danger)]'
            : 'border-[var(--color-border)] bg-[var(--color-bg-subtle)] text-[var(--color-fg-muted)] group-hover:text-[var(--color-accent-text)]'
        }`}
      >
        <Icon className="size-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-[var(--color-fg)]">{title}</div>
        <div className="text-[11px] text-[var(--color-fg-subtle)] truncate">{hint}</div>
      </div>
      <ArrowRight className="size-3.5 text-[var(--color-fg-subtle)] group-hover:translate-x-0.5 transition-transform" />
    </Link>
  );
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
  const [time, setTime] = useState(fmt);
  useEffect(() => {
    const id = setInterval(() => setTime(fmt()), 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="font-mono text-[var(--color-accent-text)]">{time}</span>;
});
