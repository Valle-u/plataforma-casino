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
  Coins,
  Gauge,
  ShieldAlert,
  ShieldCheck,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
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

export default function DashboardPage() {
  const { user } = useAuth();
  const stats = useDashboardStats();
  const [time, setTime] = useState<string>('');
  // Fase 4 · banner de bankroll: sólo para quien tiene una caja "de negocio":
  // admin_tenant (la Casa) o socio indep (su wallet como bankroll de red).
  // Un cajero/distribuidor no necesita ver esto en el dashboard.
  const adminMode = isAdminTenant(user);
  const indepMode = isIndependentBranch(user);
  const showBankrollBanner =
    (adminMode || indepMode) && hasPermission(user, 'house.view');
  const bankrollOperatorId = indepMode ? (user?.id ?? null) : null;
  const canInject = hasPermission(user, 'house.inject_capital');

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setTime(
        now.toLocaleTimeString('es-AR', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      );
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-8 max-w-[1600px] mx-auto">
      {/* ── Hero strip ──────────────────────────────────────── */}
      <section className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 pb-2">
        <div className="flex flex-col gap-3 animate-fade-up">
          <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
            <span className="font-mono text-[var(--color-accent-text)]">{time}</span>
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

        <div className="flex items-center gap-2">
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

      {/* ── KPIs ────────────────────────────────────────────── */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-[var(--color-border)]">
        <KpiTile
          loading={stats.loading}
          label="Usuarios totales"
          value={stats.users?.total ?? null}
          hint={
            stats.users ? `${stats.users.active} activos` : 'cargando…'
          }
        />
        <KpiTile
          loading={stats.loading}
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
          loading={stats.loading}
          label="Señales antifraude"
          value={stats.fraud?.totalSignals ?? null}
          hint="histórico"
        />
        <KpiTile
          loading={stats.loading}
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
            <div className="flex items-center gap-2">
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
          <div className="flex items-center gap-2">
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
            />
            <QuickAction
              href="/wallet"
              icon={Coins}
              title="Operar wallet"
              hint="Mint, burn o transferir fichas"
            />
            <QuickAction
              href="/fraud"
              icon={
                (stats.fraud?.suspectedLinks ?? 0) > 0 ? ShieldAlert : ShieldCheck
              }
              title="Revisar antifraude"
              hint={
                stats.fraud
                  ? `${stats.fraud.suspectedLinks} suspected pendientes`
                  : 'Cargando…'
              }
              accent={(stats.fraud?.suspectedLinks ?? 0) > 0}
            />
          </div>
        </div>
      </div>

      {/* ── Footer meta ─────────────────────────────────────── */}
      <footer className="flex items-center justify-between text-[10px] text-[var(--color-fg-subtle)] uppercase tracking-[0.12em] pt-6 border-t border-[var(--color-border)]">
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
      <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] p-4 flex flex-col gap-3">
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
}: {
  href: string;
  icon: typeof Activity;
  title: string;
  hint: string;
  accent?: boolean;
}) {
  return (
    <Link
      href={href}
      className="group bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-subtle)] p-3 flex items-center gap-3 transition-colors duration-150 border-l-2 border-l-transparent hover:border-l-[var(--color-accent)]"
    >
      <div
        className={`size-8 shrink-0 border flex items-center justify-center transition-colors ${
          accent
            ? 'border-[var(--color-accent-border)] bg-[var(--color-accent-subtle)]'
            : 'border-[var(--color-border)] bg-[var(--color-bg-subtle)] group-hover:border-[var(--color-accent-border)]'
        }`}
      >
        <Icon
          className={`size-3.5 transition-colors ${
            accent ? 'text-[var(--color-accent-text)]' : 'text-[var(--color-fg-muted)] group-hover:text-[var(--color-accent-text)]'
          }`}
        />
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
