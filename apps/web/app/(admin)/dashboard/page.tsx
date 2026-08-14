/**
 * /dashboard — pantalla inicial del operador.
 *
 * KPIs conectados al backend via `useDashboardStats`:
 *   - Total users + activos (deriva del list).
 *   - Fraud stats (signals, suspected, confirmed, dismissed).
 *   - Bonuses active stats.
 *
 * Mientras carga: skeletons en cada tile.
 * Si un endpoint falla individualmente: el tile muestra "—" y un dot
 * danger arriba. El dashboard no se rompe entero.
 */

'use client';

import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  Coins,
  Gauge,
  ShieldAlert,
  ShieldCheck,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { memo, useEffect, useMemo, useState } from 'react';
import { StockAlertBanner } from '@/components/admin/stock-alert-banner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import {
  hasPermission,
  isAdminTenant,
  isIndependentBranch,
  useAuth,
} from '@/lib/auth-context';
import { useDashboardStats } from '@/lib/hooks/use-dashboard-stats';
import {
  useHousePnl,
  usePayablesByRole,
  type PayablesByRoleEntry,
} from '@/lib/hooks/use-network-commissions';
import { useWalletStatsScopedAudit } from '@/lib/hooks/use-wallet-stats';

export default function DashboardPage() {
  const { user } = useAuth();
  const stats = useDashboardStats();
  const adminMode = isAdminTenant(user);
  const indepMode = isIndependentBranch(user);
  const showBankrollBanner =
    (adminMode || indepMode) && hasPermission(user, 'house.view');
  const bankrollOperatorId = indepMode ? (user?.id ?? null) : null;
  const canInject = hasPermission(user, 'house.inject_capital');
  // Resumen financiero: requiere ver todo el tenant (no solo la red propia) —
  // mismo gate que /network-commissions y el modo "Netwin por red" de
  // /wallet-stats, así que en la práctica es admin_tenant.
  const showFinancialSummary =
    hasPermission(user, 'wallet_stats.view_any') &&
    hasPermission(user, 'commissions.view_all');

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-8 max-w-[1600px] mx-auto">
      {/* ── Hero strip ──────────────────────────────────────── */}
      <section className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 pb-2">
        <div className="flex flex-col gap-3 animate-fade-up">
          <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
            <ClockBadge />
            <span className="text-[var(--color-fg-subtle)]">·</span>
            <span>Sesión activa</span>
            {stats.hasError && (
              <>
                <span className="text-[var(--color-fg-subtle)]">·</span>
                <Badge variant="danger" dot>
                  Datos parciales
                </Badge>
              </>
            )}
          </span>
          <h1 className="font-display text-[2.5rem] lg:text-[3.25rem] leading-none tracking-tight">
            Buen día,{' '}
            <span className="text-[var(--color-accent-text)]">
              {firstName(user?.displayName ?? user?.username ?? 'Operador')}
            </span>
          </h1>
          <p className="text-sm text-[var(--color-fg-muted)] max-w-xl mt-1">
            Estás operando el tenant{' '}
            <span className="font-mono text-[var(--color-fg)]">
              {process.env.NEXT_PUBLIC_TENANT_HOST ?? 'demo.localhost'}
            </span>
            . Toda mutación queda registrada en el audit log.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="md" asChild>
            <Link href="/audit">
              <Activity className="size-3.5" />
              Ver actividad
            </Link>
          </Button>
          <Button variant="primary" size="md" asChild>
            <Link href="/users">
              Gestionar usuarios
              <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        </div>
      </section>

      {/* ── Bankroll banner ─────────────────────────────────── */}
      {showBankrollBanner && (
        <StockAlertBanner
          operatorUserId={bankrollOperatorId}
          showInjectCta={adminMode && canInject}
          compact
        />
      )}

      {/* ── Resumen financiero ───────────────────────────────── */}
      {showFinancialSummary && <FinancialSummarySection />}

      {/* ── KPIs ────────────────────────────────────────────── */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-[var(--color-border)]">
        <KpiTile
          loading={stats.usersLoading}
          label="Usuarios totales"
          value={stats.users?.total ?? null}
          hint={
            stats.users ? `${stats.users.active} activos` : 'cargando…'
          }
        />
        <KpiTile
          loading={stats.fraudLoading}
          label="Links sospechosos"
          value={stats.fraud?.suspectedLinks ?? null}
          variant={
            (stats.fraud?.suspectedLinks ?? 0) > 0 ? 'accent' : 'default'
          }
          hint={
            stats.fraud
              ? `${stats.fraud.confirmedLinks} confirmados`
              : 'cargando…'
          }
        />
        <KpiTile
          loading={stats.fraudLoading}
          label="Señales antifraude"
          value={stats.fraud?.totalSignals ?? null}
          hint="histórico"
        />
        <KpiTile
          loading={stats.bonusesLoading}
          label="Bonos activos"
          value={
            typeof stats.bonuses?.totalActive === 'number'
              ? stats.bonuses.totalActive
              : null
          }
          hint={
            typeof stats.bonuses?.totalRemainingChips === 'string'
              ? `${stats.bonuses.totalRemainingChips} fichas`
              : '—'
          }
        />
      </section>

      {/* ── Activity feed + Quick actions ──────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-px bg-[var(--color-border)]">
        {/* Activity */}
        <div className="bg-[var(--color-bg-elevated)] p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-2">
              <Activity className="size-3.5 text-[var(--color-accent-text)]" />
              <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-medium">
                Actividad reciente
              </span>
            </div>
            <Link
              href="/audit"
              className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] transition-colors flex items-center gap-1"
            >
              Ver todo
              <ArrowUpRight className="size-3" />
            </Link>
          </div>
          <EmptyState
            hint="events"
            stream="audit_log:tenant:jest"
            label="Endpoint de audit-feed se conecta en sprint próximo"
          />
        </div>

        {/* Quick actions */}
        <div className="bg-[var(--color-bg-elevated)] p-5 flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Gauge className="size-3.5 text-[var(--color-accent-text)]" />
            <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-medium">
              Atajos
            </span>
          </div>

          <div className="flex flex-col gap-px bg-[var(--color-border)]">
            <QuickAction
              href="/users"
              icon={Users}
              title="Gestionar usuarios"
              hint={
                stats.users
                  ? `${stats.users.total} en el tenant`
                  : 'Ver lista'
              }
              tone="success"
            />
            <QuickAction
              href="/wallet"
              icon={Coins}
              title="Operar wallet"
              hint="Mint, burn o transferir fichas"
            />
            <QuickAction
              href="/integrity"
              icon={
                (stats.fraud?.suspectedLinks ?? 0) > 0 ? ShieldAlert : ShieldCheck
              }
              title="Integridad y seguridad"
              hint={
                stats.fraud
                  ? `${stats.fraud.suspectedLinks} cuentas por revisar`
                  : 'Cargando…'
              }
              accent={(stats.fraud?.suspectedLinks ?? 0) > 0}
              tone={(stats.fraud?.suspectedLinks ?? 0) > 0 ? 'danger' : 'default'}
            />
          </div>
        </div>
      </div>

      {/* ── Footer meta ─────────────────────────────────────── */}
      <footer className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[10px] text-[var(--color-fg-subtle)] uppercase tracking-[0.12em] pt-6 border-t border-[var(--color-border)]">
        <span className="font-mono normal-case">
          tenant://jest · build {new Date().getFullYear()}.
          {(new Date().getMonth() + 1).toString().padStart(2, '0')}
        </span>
        <span>El sistema graba todas las acciones</span>
      </footer>
    </div>
  );
}

interface KpiTileProps {
  loading: boolean;
  label: string;
  value: number | null;
  hint: string;
  variant?: 'default' | 'accent';
}

function KpiTile({ loading, label, value, hint, variant }: KpiTileProps) {
  if (loading) {
    return (
      <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto p-4 flex flex-col gap-3">
        <Skeleton className="h-3 w-24 bg-[var(--color-bg-subtle)]" />
        <Skeleton className="h-8 w-16 bg-[var(--color-bg-subtle)]" />
        <Skeleton className="h-3 w-20 bg-[var(--color-bg-subtle)]" />
      </div>
    );
  }
  return (
    <StatTile
      label={label}
      value={value ?? '—'}
      hint={hint}
      variant={variant}
    />
  );
}

function QuickAction({
  href,
  icon: Icon,
  title,
  hint,
  accent,
  tone,
}: {
  href: string;
  icon: typeof Activity;
  title: string;
  hint: string;
  accent?: boolean;
  tone?: 'default' | 'danger' | 'success';
}) {
  const iconColor = tone === 'danger'
    ? 'text-[var(--color-danger)]'
    : tone === 'success'
      ? 'text-[var(--color-success)]'
      : accent
        ? 'text-[var(--color-accent-text)]'
        : 'text-[var(--color-fg-muted)] group-hover:text-[var(--color-accent-text)]';

  const boxBorder = tone === 'danger'
    ? 'border-[var(--color-danger)] bg-[var(--color-danger-bg)]'
    : tone === 'success'
      ? 'border-[var(--color-success)] bg-[var(--color-success-bg)]'
      : accent
        ? 'border-[var(--color-accent-border)] bg-[var(--color-accent-subtle)]'
        : 'border-[var(--color-border)] bg-[var(--color-bg-subtle)] group-hover:border-[var(--color-accent-border)]';

  return (
    <Link
      href={href}
      className="group bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-subtle)] p-3 flex items-center gap-3 transition-colors duration-150 border-l-2 border-l-transparent hover:border-l-[var(--color-accent)]"
    >
      <div
        className={`size-8 shrink-0 border flex items-center justify-center transition-colors ${boxBorder}`}
      >
        <Icon className={`size-3.5 transition-colors ${iconColor}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-[var(--color-fg)] tracking-tight">{title}</div>
        <div className="text-[11px] text-[var(--color-fg-subtle)] truncate">{hint}</div>
      </div>
      <ArrowRight className="size-3.5 text-[var(--color-fg-subtle)] group-hover:text-[var(--color-fg-muted)] group-hover:translate-x-0.5 transition-all" />
    </Link>
  );
}

function firstName(full: string): string {
  return full.split(/\s+/)[0] || full;
}

// ──────────────────────────────────────────────────────────────────────
// Resumen financiero — depósitos/retiros (mes), deuda a game providers en
// vivo, comisiones pendientes por rol. Responde de un vistazo lo que antes
// requería visitar /wallet-stats (pestaña "Netwin por red") y
// /network-commissions por separado, y sumar el desglose por rol a mano.
// ──────────────────────────────────────────────────────────────────────

const ROLE_LABEL: Record<PayablesByRoleEntry['role'], string> = {
  socio: 'Socios',
  distribuidor: 'Distribuidores',
  cajero: 'Cajeros',
  otro: 'Otros',
};

const MONTH_LABEL_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/** 'YYYY-MM' actual, en la misma convención que usa el motor de comisiones. */
function currentPeriodLabel(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function periodLabelEs(period: string): string {
  const [y, m] = period.split('-');
  const idx = Number(m) - 1;
  return `${MONTH_LABEL_ES[idx] ?? m} ${y}`;
}

function fmtMoney(x: string | number | null | undefined): string {
  if (x === null || x === undefined) return '—';
  const n = Number(x);
  if (!Number.isFinite(n)) return String(x);
  return n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function FinancialSummarySection() {
  const period = useMemo(() => currentPeriodLabel(), []);
  // Mismo mes que `period`, pero como rango de fechas para el scoped-audit
  // de wallet-stats (que no entiende 'YYYY-MM').
  const range = useMemo(() => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    return { dateFrom: from.toISOString(), dateTo: now.toISOString() };
  }, []);

  const audit = useWalletStatsScopedAudit({ scope: 'platform', ...range });
  // `getHousePnl` calcula netWin/providerFee EN VIVO desde game_rounds
  // liquidadas — no depende de que el período de comisiones esté "computado"
  // (eso solo afecta el campo `commissions`, que acá ni se usa).
  const pnl = useHousePnl(period);
  const payables = usePayablesByRole();

  const loading = audit.isLoading || pnl.isLoading || payables.isLoading;
  const hasError = audit.isError || pnl.isError || payables.isError;

  const providerFeeTotal = pnl.data
    ? Number(pnl.data.dependent.providerFee) + Number(pnl.data.independent.providerFee)
    : null;

  return (
    <section className="flex flex-col gap-4 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
            <Banknote className="size-3.5 text-[var(--color-accent-text)]" />
            Resumen financiero · {periodLabelEs(period)}
          </span>
          <span className="text-[11px] text-[var(--color-fg-subtle)]">
            Plata real del mes en curso, deuda a proveedores de juego en vivo, y
            comisiones pendientes acumuladas (todos los períodos).
          </span>
        </div>
        {hasError && (
          <Badge variant="danger" dot>
            Datos parciales
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 bg-[var(--color-bg-subtle)]" />
          ))
        ) : (
          <>
            <StatTile
              label="Depósitos (mes)"
              value={audit.data ? fmtMoney(audit.data.plata.depositos) : '—'}
              hint="plata que entró"
            />
            <StatTile
              label="Retiros (mes)"
              value={audit.data ? fmtMoney(audit.data.plata.retiros) : '—'}
              hint="plata que salió"
            />
            <StatTile
              label="Neto de caja"
              value={audit.data ? fmtMoney(audit.data.plata.neto) : '—'}
              hint="depósitos − retiros"
              variant={
                audit.data && Number(audit.data.plata.neto) < 0 ? 'accent' : 'default'
              }
            />
            <StatTile
              label="Deuda a game providers"
              value={providerFeeTotal !== null ? fmtMoney(providerFeeTotal) : '—'}
              hint="netwin del mes × fee%"
            />
            <StatTile
              label="Comisiones pendientes"
              value={payables.data ? fmtMoney(payables.data.totalPending) : '—'}
              hint="acumulado, todo período"
              variant={
                payables.data && Number(payables.data.totalPending) > 0
                  ? 'accent'
                  : 'default'
              }
            />
          </>
        )}
      </div>

      {!loading && !!payables.data?.byRole.length && (
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-[var(--color-border)]">
          <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
            Comisiones pendientes por rol
          </span>
          {payables.data.byRole.map((r) => (
            <span
              key={r.role}
              className="inline-flex items-center gap-1.5 px-2.5 h-7 text-[11px] bg-[var(--color-bg-subtle)] border border-[var(--color-border)]"
            >
              <span className="text-[var(--color-fg-muted)]">{ROLE_LABEL[r.role]}</span>
              <span className="font-mono text-[var(--color-fg)]">{fmtMoney(r.pending)}</span>
              <span className="text-[var(--color-fg-subtle)]">({r.operatorCount})</span>
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
        <Link
          href="/wallet-stats"
          className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] transition-colors flex items-center gap-1"
        >
          Ver estadísticas de pago
          <ArrowUpRight className="size-3" />
        </Link>
        <Link
          href="/network-commissions"
          className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] transition-colors flex items-center gap-1"
        >
          Ver comisiones por red
          <ArrowUpRight className="size-3" />
        </Link>
      </div>
    </section>
  );
}

/**
 * Reloj aislado — re-renderiza solo a sí mismo cada segundo.
 * No contamina al dashboard padre ni a sus KPIs.
 */
const ClockBadge = memo(function ClockBadge() {
  const [time, setTime] = useState(() =>
    new Date().toLocaleTimeString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
  );

  useEffect(() => {
    const id = setInterval(() => {
      setTime(
        new Date().toLocaleTimeString('es-AR', {
          timeZone: 'America/Argentina/Buenos_Aires',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      );
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return <span className="font-mono text-[var(--color-accent-text)]">{time}</span>;
});
