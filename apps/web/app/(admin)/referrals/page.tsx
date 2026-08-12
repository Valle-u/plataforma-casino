'use client';

import { Link2, RefreshCw, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ReferralLinkCard } from '@/components/admin/referral-link-card';
import { ReferralCampaignsSection } from '@/components/admin/referral-campaigns-section';
import { ReferralTimeSeriesChart } from '@/components/ui/referral-charts';
import { Skeleton } from '@/components/ui/skeleton';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import {
  useReferralCode,
  useReferralMetrics,
  useReferredUsers,
} from '@/lib/hooks/use-referrals';

const PERIOD_OPTIONS = [
  { label: '7 días', days: 7 },
  { label: '30 días', days: 30 },
  { label: '90 días', days: 90 },
] as const;

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'active'
      ? 'var(--color-success)'
      : status === 'banned'
        ? 'var(--color-danger)'
        : 'var(--color-fg-subtle)';
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: color }}
      />
      <span className="capitalize">{status}</span>
    </span>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-lg p-3"
      style={{ background: 'var(--color-bg-subtle)' }}
    >
      <span
        className="text-xs block mb-1"
        style={{ color: 'var(--color-text-muted)' }}
      >
        {label}
      </span>
      <span
        className="text-2xl font-bold tabular-nums"
        style={{ color: 'var(--color-text)' }}
      >
        {value}
      </span>
    </div>
  );
}

export default function ReferralsPage() {
  const { refetch: refetchCode } = useReferralCode();
  const [period, setPeriod] = useState(30);
  const [page, setPage] = useState(1);
  // Drill-down: null = agregado (todos los códigos); si viene, filtra por code.
  const [selected, setSelected] = useState<{ code: string; label: string } | null>(
    null,
  );

  const {
    data: metrics,
    isLoading: metricsLoading,
    refetch: refetchMetrics,
  } = useReferralMetrics(period, selected?.code);
  const { data: referredData, isLoading: referredLoading } = useReferredUsers(
    page,
    20,
    selected?.code,
  );

  const handleRefresh = () => {
    refetchCode();
    refetchMetrics();
  };

  const handleSelect = (code: string | null, label?: string) => {
    setSelected(code ? { code, label: label ?? code } : null);
    setPage(1);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link2 className="h-6 w-6" style={{ color: 'var(--color-text-muted)' }} />
          <div>
            <h1
              className="text-2xl font-bold"
              style={{
                color: 'var(--color-text)',
                fontFamily: 'var(--font-display)',
              }}
            >
              Mis Referidos
            </h1>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Tu link personal para compartir y atraer jugadores
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={handleRefresh}>
          <RefreshCw className="h-4 w-4 mr-1" />
          Actualizar
        </Button>
      </div>

      {/* Referral link card (código base — oculto para el admin) */}
      <ReferralLinkCard />

      {/* Campañas (códigos extra + métricas por código) */}
      <ReferralCampaignsSection
        selectedCode={selected?.code ?? null}
        onSelect={handleSelect}
      />

      {/* Charts section */}
      <div
        className="rounded-xl p-6"
        style={{
          background: 'var(--color-bg-elevated)',
          border: '1px solid var(--color-border)',
        }}
      >
        <div className="flex items-start justify-between mb-4 gap-3">
          <div className="min-w-0">
            <h3
              className="text-lg font-semibold"
              style={{ color: 'var(--color-text)' }}
            >
              Métricas por período
            </h3>
            {selected && (
              <button
                onClick={() => handleSelect(null)}
                className="mt-1 inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium transition-colors"
                style={{
                  background: 'var(--color-accent-subtle)',
                  color: 'var(--color-accent-text)',
                  border: '1px solid var(--color-accent-border)',
                }}
                title="Ver métricas de todos los códigos"
              >
                Filtrando: {selected.label}
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <div className="flex gap-1 shrink-0">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.days}
                onClick={() => {
                  setPeriod(opt.days);
                  setPage(1);
                }}
                className="rounded-md px-3 py-1 text-xs font-medium transition-colors"
                style={{
                  background:
                    period === opt.days
                      ? 'var(--color-accent-subtle)'
                      : 'transparent',
                  color:
                    period === opt.days
                      ? 'var(--color-accent-text)'
                      : 'var(--color-fg-muted)',
                  border:
                    period === opt.days
                      ? '1px solid var(--color-accent-border)'
                      : '1px solid transparent',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {metricsLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-[72px] w-full" />
            <Skeleton className="h-[200px] w-full" />
            <Skeleton className="h-[200px] w-full" />
          </div>
        ) : metrics ? (
          <div className="space-y-6">
            {/* Resumen del período (incluye FTD acumulado) */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <SummaryStat
                label="Clicks"
                value={metrics.summary.totalClicks.toLocaleString()}
              />
              <SummaryStat
                label="Registros"
                value={metrics.summary.totalSignups.toLocaleString()}
              />
              <SummaryStat
                label="Conversión"
                value={
                  metrics.summary.totalClicks > 0
                    ? `${metrics.summary.conversionRate}%`
                    : '—'
                }
              />
              <SummaryStat
                label="Depositaron (FTD)"
                value={metrics.summary.ftds.toLocaleString()}
              />
            </div>
            <ReferralTimeSeriesChart
              data={metrics.period.map((d) => ({
                date: d.date,
                value: d.clicks,
              }))}
              label="Clicks por día"
              color="var(--color-accent)"
            />
            <ReferralTimeSeriesChart
              data={metrics.period.map((d) => ({
                date: d.date,
                value: d.signups,
              }))}
              label="Registros por día"
              color="var(--color-success)"
            />
          </div>
        ) : null}
      </div>

      {/* Referred users table */}
      <div
        className="rounded-xl p-6"
        style={{
          background: 'var(--color-bg-elevated)',
          border: '1px solid var(--color-border)',
        }}
      >
        <h3
          className="text-lg font-semibold mb-4"
          style={{ color: 'var(--color-text)' }}
        >
          {selected ? `Referidos · ${selected.label}` : 'Referidos recientes'}
        </h3>

        {referredLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : referredData && referredData.users.length > 0 ? (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>Usuario</TH>
                  <TH>Nombre</TH>
                  <TH className="hidden sm:table-cell">Fecha</TH>
                  <TH>Estado</TH>
                </TR>
              </THead>
              <TBody>
                {referredData.users.map((u) => (
                  <TR key={u.id}>
                    <TD className="font-mono">{u.username}</TD>
                    <TD>{u.displayName}</TD>
                    <TD className="hidden sm:table-cell text-[var(--color-fg-muted)]">
                      {new Date(u.attributedAt).toLocaleDateString('es-AR', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </TD>
                    <TD>
                      <StatusDot status={u.status} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>

            {/* Pagination */}
            {referredData.total > referredData.limit && (
              <div className="flex items-center justify-between mt-4 pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
                <span className="text-xs" style={{ color: 'var(--color-fg-muted)' }}>
                  {referredData.total} referidos total · Página {referredData.page} de{' '}
                  {Math.ceil(referredData.total / referredData.limit)}
                </span>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Anterior
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={
                      page >= Math.ceil(referredData.total / referredData.limit)
                    }
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Siguiente
                  </Button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div
            className="text-center py-8 text-sm"
            style={{ color: 'var(--color-fg-subtle)' }}
          >
            Aún no tenés referidos. Compartí tu link para empezar.
          </div>
        )}
      </div>

      {/* How it works */}
      <div
        className="rounded-xl p-6"
        style={{
          background: 'var(--color-bg-elevated)',
          border: '1px solid var(--color-border)',
        }}
      >
        <h3
          className="text-lg font-semibold mb-4"
          style={{ color: 'var(--color-text)' }}
        >
          ¿Cómo funciona?
        </h3>
        <div
          className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm"
          style={{ color: 'var(--color-text-muted)' }}
        >
          <div
            className="rounded-lg p-4"
            style={{ background: 'var(--color-bg-subtle)' }}
          >
            <span
              className="text-lg font-bold block mb-1"
              style={{ color: 'var(--color-text)' }}
            >
              1. Compartí
            </span>
            <p>
              Mandá tu link por WhatsApp, redes sociales o donde quieras. Cada
              persona que haga click queda registrada.
            </p>
          </div>
          <div
            className="rounded-lg p-4"
            style={{ background: 'var(--color-bg-subtle)' }}
          >
            <span
              className="text-lg font-bold block mb-1"
              style={{ color: 'var(--color-text)' }}
            >
              2. Se registran
            </span>
            <p>
              Cuando un jugador se registre a través de tu link, quedará vinculado
              a tu cuenta como usuario final bajo tu jerarquía.
            </p>
          </div>
          <div
            className="rounded-lg p-4"
            style={{ background: 'var(--color-bg-subtle)' }}
          >
            <span
              className="text-lg font-bold block mb-1"
              style={{ color: 'var(--color-text)' }}
            >
              3. Seguís acá
            </span>
            <p>
              Volvé a esta página para ver cuántos clicks y registros generaste.
              ¡Tus métricas se actualizan en tiempo real!
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
