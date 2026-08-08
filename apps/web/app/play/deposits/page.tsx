/**
 * /play/deposits — Mis depósitos (rediseño "Neón Milonga", Casino TANGO).
 *
 * Pantalla "Depósitos" del handoff. El chrome lo provee play/layout.tsx.
 *
 * Composición:
 *   - Header: kicker + título + "Solicitar depósito" + Refrescar.
 *   - Banner "¿Cómo funciona?".
 *   - 3 stats: Total acreditado · En revisión · Último depósito.
 *   - Tabs por estado (Todas / Acreditadas / En revisión / Rechazadas).
 *   - Lista de solicitudes (icono por estado + #id + fecha·método + monto).
 *
 * Función PRESERVADA del catálogo anterior:
 *   - useMyDeposits (GET /tenant/deposits/me) → lista con status/montos/método.
 *   - NewDepositModal (flujo de carga: montos, método, resumen, comprobante).
 *   - Refrescar + estados loading/error/empty.
 */

'use client';

import {
  ArrowDownToLine,
  Ban,
  Check,
  Clock,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { NewDepositModal } from '@/components/player/new-deposit-modal';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useMyDeposits, type DepositStatus } from '@/lib/hooks/use-deposits';
import { cn } from '@/lib/cn';

/** Presentación por estado: tono (color), etiqueta y un ícono. */
const STATUS_META: Record<
  DepositStatus,
  { tone: string; label: string; icon: typeof Check }
> = {
  approved: { tone: 'var(--color-success)', label: 'Acreditado', icon: Check },
  under_review: { tone: 'var(--color-gold)', label: 'En revisión', icon: Clock },
  pending: { tone: 'var(--color-gold)', label: 'En revisión', icon: Clock },
  rejected: { tone: 'var(--color-danger)', label: 'Rechazado', icon: X },
  expired: { tone: 'var(--color-fg-subtle)', label: 'Expirado', icon: Ban },
  cancelled: { tone: 'var(--color-fg-subtle)', label: 'Cancelado', icon: Ban },
};

type Group = 'all' | 'approved' | 'review' | 'rejected';

const GROUP_TABS: { id: Group; label: string }[] = [
  { id: 'all', label: 'Todas' },
  { id: 'approved', label: 'Acreditadas' },
  { id: 'review', label: 'En revisión' },
  { id: 'rejected', label: 'Rechazadas' },
];

function inGroup(status: DepositStatus, group: Group): boolean {
  if (group === 'all') return true;
  if (group === 'approved') return status === 'approved';
  if (group === 'review') return status === 'pending' || status === 'under_review';
  if (group === 'rejected') return status === 'rejected';
  return true;
}

const arsFmt = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export default function PlayDepositsPage() {
  const searchParams = useSearchParams();
  const [newOpen, setNewOpen] = useState(false);
  const [group, setGroup] = useState<Group>('all');
  const { data, isLoading, isError, refetch, isFetching } = useMyDeposits(50, 0);

  useEffect(() => {
    if (searchParams.get('new') === '1') setNewOpen(true);
  }, [searchParams]);

  const rows = useMemo(() => data?.data ?? [], [data]);

  const filtered = useMemo(
    () => rows.filter((d) => inGroup(d.status, group)),
    [rows, group],
  );

  const counts = useMemo(
    () => ({
      all: rows.length,
      approved: rows.filter((d) => d.status === 'approved').length,
      review: rows.filter(
        (d) => d.status === 'pending' || d.status === 'under_review',
      ).length,
      rejected: rows.filter((d) => d.status === 'rejected').length,
    }),
    [rows],
  );

  const stats = useMemo(() => {
    const totalApproved = rows
      .filter((d) => d.status === 'approved')
      .reduce((sum, d) => sum + Number(d.amountChips), 0);
    const last = rows.length > 0 ? rows[0]?.createdAt : null;
    return { totalApproved, inReview: counts.review, last };
  }, [rows, counts.review]);

  return (
    <>
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        {/* Header */}
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent-text)]">
              <ArrowDownToLine className="size-3" />
              Tus depósitos
            </span>
            <h1 className="font-display text-[34px] leading-none">Mis depósitos</h1>
            <p className="text-[13px] text-[var(--color-fg-muted)]">
              {data ? `${rows.length} solicitud(es)` : 'Cargando…'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="md"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={cn('size-3.5', isFetching && 'animate-spin')} />
              <span className="hidden sm:inline">Refrescar</span>
            </Button>
            <Button variant="primary" size="md" onClick={() => setNewOpen(true)}>
              <Plus className="size-3.5" />
              Solicitar depósito
            </Button>
          </div>
        </header>

        {/* Banner explicativo */}
        <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-4 py-3 text-[12px] text-[var(--color-fg-muted)]">
          <span className="font-medium text-[var(--color-fg)]">
            ¿Cómo funciona?
          </span>{' '}
          Transferí primero por el método elegido, después cargá la solicitud
          acá. El cajero revisa el comprobante y acredita las fichas. Suele tardar
          pocos minutos en horario operativo.
        </div>

        {/* 3 stats */}
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard
            label="Total acreditado"
            value={`$ ${arsFmt.format(stats.totalApproved)}`}
            accent="var(--color-success)"
            loading={isLoading}
          />
          <StatCard
            label="En revisión"
            value={String(stats.inReview)}
            accent="var(--color-gold)"
            loading={isLoading}
          />
          <StatCard
            label="Último depósito"
            value={stats.last ? formatWhen(stats.last) : '—'}
            accent="var(--color-accent)"
            loading={isLoading}
          />
        </section>

        {/* Tabs por estado */}
        <div className="flex flex-wrap items-center gap-2">
          {GROUP_TABS.map((t) => {
            const active = group === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setGroup(t.id)}
                aria-pressed={active}
                className={cn(
                  'inline-flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-medium transition-colors',
                  active
                    ? 'text-[var(--color-accent-fg)]'
                    : 'border border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] hover:border-[var(--color-accent-border)] hover:text-[var(--color-fg)]',
                )}
                style={active ? { background: 'var(--gradient-accent)' } : undefined}
              >
                {t.label}
                <span
                  className={cn(
                    'text-[11px] tabular-nums',
                    active ? 'opacity-80' : 'text-[var(--color-fg-subtle)]',
                  )}
                >
                  {counts[t.id]}
                </span>
              </button>
            );
          })}
        </div>

        {/* Lista */}
        <section className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
          {isLoading ? (
            <LoadingList />
          ) : isError ? (
            <div className="p-6">
              <EmptyState
                label="Ups, no pudimos cargar tus depósitos."
                description="Esperá unos segundos y probá de nuevo."
                action={
                  <Button variant="secondary" size="sm" onClick={() => refetch()}>
                    Reintentar
                  </Button>
                }
              />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState
                label={
                  group === 'all'
                    ? 'Todavía no hiciste ningún depósito.'
                    : 'No hay depósitos en esta categoría.'
                }
                description={
                  group === 'all'
                    ? 'Cargá fichas y empezá a jugar en minutos.'
                    : undefined
                }
                action={
                  group === 'all' ? (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => setNewOpen(true)}
                    >
                      <Plus className="size-3.5" />
                      Hacer el primer depósito
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {filtered.map((d) => {
                const meta = STATUS_META[d.status];
                const Icon = meta.icon;
                const credited = d.status === 'approved';
                return (
                  <li key={d.id} className="flex items-center gap-3 px-4 py-3.5">
                    <span
                      className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-sm)]"
                      style={{
                        background: `color-mix(in srgb, ${meta.tone} 20%, transparent)`,
                        color: meta.tone,
                        boxShadow: `0 0 12px -4px ${meta.tone}`,
                      }}
                      aria-hidden
                    >
                      <Icon className="size-4" />
                    </span>

                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[14px] font-medium text-[var(--color-fg)]">
                        Depósito #{d.id.slice(0, 4).toUpperCase()}
                      </span>
                      <span className="truncate text-[11px] text-[var(--color-fg-subtle)]">
                        {formatWhen(d.createdAt)}
                        {d.methodName || d.methodCode
                          ? ` · ${d.methodName ?? d.methodCode}`
                          : ''}
                      </span>
                    </div>

                    <span
                      className="hidden shrink-0 text-[9px] font-semibold uppercase tracking-[0.14em] sm:inline"
                      style={{ color: meta.tone }}
                    >
                      {meta.label}
                    </span>

                    <span
                      className="shrink-0 text-right text-[15px] font-semibold tabular-nums"
                      style={{
                        color: credited
                          ? 'var(--color-success)'
                          : 'var(--color-fg-muted)',
                      }}
                    >
                      + {arsFmt.format(Number(d.amountChips))}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <NewDepositModal open={newOpen} onOpenChange={setNewOpen} />
    </>
  );
}

function StatCard({
  label,
  value,
  accent,
  loading,
}: {
  label: string;
  value: string;
  accent: string;
  loading: boolean;
}) {
  return (
    <div
      className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-5"
      style={{
        backgroundImage: `radial-gradient(120% 80% at 100% 0%, color-mix(in srgb, ${accent} 12%, transparent) 0%, transparent 60%)`,
      }}
    >
      <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
        {label}
      </span>
      <div
        className="mt-2 font-display leading-none"
        style={{ fontSize: '1.75rem', color: accent }}
      >
        {loading ? '—' : value}
      </div>
    </div>
  );
}

function LoadingList() {
  return (
    <div className="flex flex-col gap-2 p-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full bg-[var(--color-bg-subtle)]" />
      ))}
    </div>
  );
}

function formatWhen(iso: string | Date): string {
  try {
    const d = typeof iso === 'string' ? new Date(iso) : iso;
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    const time = d.toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
    });
    if (sameDay) return `Hoy · ${time}`;
    const date = d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
    return `${date} · ${time}`;
  } catch {
    return String(iso);
  }
}
