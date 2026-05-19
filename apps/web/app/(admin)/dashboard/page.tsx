/**
 * /dashboard â€” pantalla inicial del operador.
 *
 * KPIs conectados al backend via `useDashboardStats`:
 *   - Total users + activos (deriva del list).
 *   - Fraud stats (signals, suspected, confirmed, dismissed).
 *   - Bonuses active stats.
 *
 * Mientras carga: skeletons en cada tile.
 * Si un endpoint falla individualmente: el tile muestra "â€”" y un dot
 * danger arriba. El dashboard no se rompe entero.
 */

'use client';

import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Coins,
  Gauge,
  Percent,
  ShieldAlert,
  ShieldCheck,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { useAuth } from '@/lib/auth-context';
import {
  useCommissionsStats,
  type CommissionsStats,
} from '@/lib/hooks/use-commissions';
import { useDashboardStats } from '@/lib/hooks/use-dashboard-stats';

export default function DashboardPage() {
  const { user } = useAuth();
  const stats = useDashboardStats();
  const commissions = useCommissionsStats();
  const [time, setTime] = useState<string>('');

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
      {/* â”€â”€ Hero strip â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <section className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 pb-2">
        <div className="flex flex-col gap-3 animate-fade-up">
          <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
            <span className="font-mono text-[var(--color-accent-text)]">{time}</span>
            <span className="text-[var(--color-fg-subtle)]">Â·</span>
            <span>SesiÃ³n activa</span>
            {stats.hasError && (
              <>
                <span className="text-[var(--color-fg-subtle)]">Â·</span>
                <Badge variant="danger" dot>
                  Datos parciales
                </Badge>
              </>
            )}
          </span>
          <h1 className="font-display text-[2.5rem] lg:text-[3.25rem] leading-none tracking-tight">
            Buen dÃ­a,{' '}
            <span className="text-[var(--color-accent-text)]">
              {firstName(user?.displayName ?? user?.username ?? 'Operador')}
            </span>
          </h1>
          <p className="text-sm text-[var(--color-fg-muted)] max-w-xl mt-1">
            EstÃ¡s operando el tenant{' '}
            <span className="font-mono text-[var(--color-fg)]">
              {process.env.NEXT_PUBLIC_TENANT_HOST ?? 'demo.localhost'}
            </span>
            . Toda mutaciÃ³n queda registrada en el audit log.
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

      {/* â”€â”€ KPIs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-[var(--color-border)]">
        <KpiTile
          loading={stats.loading}
          label="Usuarios totales"
          value={stats.users?.total ?? null}
          hint={
            stats.users ? `${stats.users.active} activos` : 'cargandoâ€¦'
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
              : 'cargandoâ€¦'
          }
        />
        <KpiTile
          loading={stats.loading}
          label="SeÃ±ales antifraude"
          value={stats.fraud?.totalSignals ?? null}
          hint="histÃ³rico"
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
              ? `${stats.bonuses.totalRemainingChips} chips`
              : 'â€”'
          }
        />
      </section>

      {/* â”€â”€ Activity feed + Quick actions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
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
            label="Endpoint de audit-feed se conecta en sprint prÃ³ximo"
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
                  : 'Cargandoâ€¦'
              }
              accent={(stats.fraud?.suspectedLinks ?? 0) > 0}
            />
          </div>
        </div>
      </div>

      {/* â”€â”€ Commissions exposure (Sprint 32) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <CommissionsExposure
        data={commissions.data}
        loading={commissions.isLoading}
        isError={commissions.isError}
        forbidden={commissions.error?.message?.toLowerCase().includes('forbidden') ?? false}
      />

      {/* â”€â”€ Footer meta â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <footer className="flex items-center justify-between text-[10px] text-[var(--color-fg-subtle)] uppercase tracking-[0.12em] pt-6 border-t border-[var(--color-border)]">
        <span className="font-mono normal-case">
          tenant://jest Â· build {new Date().getFullYear()}.
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
      value={value ?? 'â€”'}
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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// CommissionsExposure (Sprint 32)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Widget de exposure: lo que el actor cobrÃ³ + lo que cobrÃ³ su team +
 * total del tenant (solo si tiene view_all). Tres tiles por scope, cada
 * uno con today/7d/30d.
 *
 * Si el actor NO tiene `commissions.view` (403), el endpoint devuelve
 * forbidden y ocultamos el widget completo â€” no toda role operativa
 * tiene el perm.
 */
function CommissionsExposure({
  data,
  loading,
  isError,
  forbidden,
}: {
  data: CommissionsStats | undefined;
  loading: boolean;
  isError: boolean;
  forbidden: boolean;
}) {
  // Sin permission o sin data â†’ no renderizamos. El dashboard sigue
  // sin afectar (no metemos un EmptyState que distraiga).
  if (forbidden) return null;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Percent className="size-3.5 text-[var(--color-accent-text)]" />
          <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-medium">
            Comisiones Â· exposure
          </span>
        </div>
        <Link
          href="/commissions"
          className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] transition-colors flex items-center gap-1"
        >
          Ver detalle
          <ArrowUpRight className="size-3" />
        </Link>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-[var(--color-border)]">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="bg-[var(--color-bg-elevated)] p-4 flex flex-col gap-3"
            >
              <Skeleton className="h-3 w-24 bg-[var(--color-bg-subtle)]" />
              <Skeleton className="h-8 w-32 bg-[var(--color-bg-subtle)]" />
              <Skeleton className="h-3 w-40 bg-[var(--color-bg-subtle)]" />
            </div>
          ))}
        </div>
      ) : isError || !data ? (
        <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] p-4 text-[12px] text-[var(--color-fg-subtle)]">
          No se pudo cargar el exposure de comisiones.
        </div>
      ) : (
        <div
          className={`grid grid-cols-1 sm:grid-cols-2 gap-px bg-[var(--color-border)] ${
            data.tenantTotal ? 'lg:grid-cols-3' : ''
          }`}
        >
          <ExposureTile
            label="Cobraste vos"
            today={data.earnedByMe.today}
            last7d={data.earnedByMe.last7d}
            last30d={data.earnedByMe.last30d}
            count7d={data.countByMe7d}
          />
          <ExposureTile
            label="CobrÃ³ tu red downstream"
            today={data.earnedByTeam.today}
            last7d={data.earnedByTeam.last7d}
            last30d={data.earnedByTeam.last30d}
            count7d={data.countByTeam7d}
          />
          {data.tenantTotal && (
            <ExposureTile
              label="Total del tenant"
              today={data.tenantTotal.today}
              last7d={data.tenantTotal.last7d}
              last30d={data.tenantTotal.last30d}
              accent
            />
          )}
        </div>
      )}
    </section>
  );
}

function ExposureTile({
  label,
  today,
  last7d,
  last30d,
  count7d,
  accent,
}: {
  label: string;
  today: string;
  last7d: string;
  last30d: string;
  count7d?: number;
  accent?: boolean;
}) {
  return (
    <div
      className={`bg-[var(--color-bg-elevated)] p-4 flex flex-col gap-3 ${
        accent ? 'border-l-2 border-l-[var(--color-accent)]' : ''
      }`}
    >
      <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-medium">
        {label}
      </span>
      <div className="flex items-baseline gap-2">
        <span className="font-display text-[1.8rem] leading-none text-[var(--color-fg)] tabular-nums">
          {formatChips(last7d)}
        </span>
        <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
          chips Â· 7d
        </span>
      </div>
      <div className="flex flex-col gap-0.5 text-[11px] text-[var(--color-fg-subtle)]">
        <div className="flex justify-between gap-2">
          <span>Hoy</span>
          <span className="font-mono tabular-nums text-[var(--color-fg-muted)]">
            {formatChips(today)}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span>Ãšltimos 30d</span>
          <span className="font-mono tabular-nums text-[var(--color-fg-muted)]">
            {formatChips(last30d)}
          </span>
        </div>
        {count7d !== undefined && (
          <div className="flex justify-between gap-2">
            <span>Pagos 7d</span>
            <span className="font-mono tabular-nums text-[var(--color-fg-muted)]">
              {count7d}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function formatChips(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'â€”';
  return n.toLocaleString('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}
