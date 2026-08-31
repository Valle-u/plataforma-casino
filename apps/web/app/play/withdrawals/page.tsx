/**
 * /play/withdrawals — Mis retiros.
 *
 * Pantalla "Retiros" del handoff. El chrome lo provee play/layout.tsx.
 *
 * Composición:
 *   - Header: kicker + título + "Solicitar retiro" (oro) + Refrescar.
 *   - Banner "¿Cómo funciona?".
 *   - 2 stats: En hold · Último retiro.
 * ⚠️ NO volver a agregar un total histórico de plata movida. Se sacó el
 *    2026-08-31 por decisión del dueño: mostrarle al jugador cuánto lleva
 *    depositado (o retirado) en toda su historia lo invita a hacer la resta,
 *    y esa resta es una razón para irse. Las stats que quedan son
 *    OPERATIVAS — responden "¿en qué estado está mi plata ahora?" — no un
 *    balance de su vida en el casino.
 *   - Tabs por estado (Todos / Pagados / En hold / En revisión / Rechazados).
 *   - Lista de solicitudes (icono por estado + #id + fecha·método + monto).
 *
 * Función PRESERVADA:
 *   - useMyWithdrawals (GET /tenant/withdrawals/me) → lista con status/montos.
 *   - NewWithdrawalModal (flujo de retiro: monto, destino CBU/alias, resumen).
 *   - Refrescar + estados loading/error/empty.
 *
 * Estados: las chips quedan EN HOLD desde pending; el operador valida, paga
 * por fuera y marca como paid (consume el hold); si rechaza, el hold se libera.
 */

'use client';

import {
  ArrowUpToLine,
  Check,
  Clock,
  Lock,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { NewWithdrawalModal } from '@/components/player/new-withdrawal-modal';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useMyWithdrawals,
  type WithdrawalStatus,
} from '@/lib/hooks/use-withdrawals';
import { cn } from '@/lib/cn';

const STATUS_META: Record<
  WithdrawalStatus,
  { tone: string; label: string; icon: typeof Check }
> = {
  paid: { tone: 'var(--color-success)', label: 'Pagado', icon: Check },
  pending: { tone: 'var(--color-gold)', label: 'En hold', icon: Lock },
  approved: { tone: 'var(--color-accent-text)', label: 'En revisión', icon: Clock },
  processing: {
    tone: 'var(--color-accent-text)',
    label: 'En revisión',
    icon: Clock,
  },
  rejected: { tone: 'var(--color-danger)', label: 'Rechazado', icon: X },
  failed: { tone: 'var(--color-danger)', label: 'Fallido', icon: X },
};

type Group = 'all' | 'paid' | 'hold' | 'review' | 'rejected';

const GROUP_TABS: { id: Group; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'paid', label: 'Pagados' },
  { id: 'hold', label: 'En hold' },
  { id: 'review', label: 'En revisión' },
  { id: 'rejected', label: 'Rechazados' },
];

function inGroup(status: WithdrawalStatus, group: Group): boolean {
  if (group === 'all') return true;
  if (group === 'paid') return status === 'paid';
  if (group === 'hold') return status === 'pending';
  if (group === 'review') return status === 'approved' || status === 'processing';
  if (group === 'rejected') return status === 'rejected' || status === 'failed';
  return true;
}

/** Chips "en hold" = todavía no finalizadas (pending / approved / processing). */
function isHeld(status: WithdrawalStatus): boolean {
  return status === 'pending' || status === 'approved' || status === 'processing';
}

const arsFmt = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export default function PlayWithdrawalsPage() {
  const searchParams = useSearchParams();
  const [newOpen, setNewOpen] = useState(false);
  const [group, setGroup] = useState<Group>('all');
  const { data, isLoading, isError, refetch, isFetching } = useMyWithdrawals(
    50,
    0,
  );

  useEffect(() => {
    if (searchParams.get('new') === '1') setNewOpen(true);
  }, [searchParams]);

  const rows = useMemo(() => data?.data ?? [], [data]);

  const filtered = useMemo(
    () => rows.filter((w) => inGroup(w.status, group)),
    [rows, group],
  );

  const counts = useMemo(
    () => ({
      all: rows.length,
      paid: rows.filter((w) => w.status === 'paid').length,
      hold: rows.filter((w) => w.status === 'pending').length,
      review: rows.filter(
        (w) => w.status === 'approved' || w.status === 'processing',
      ).length,
      rejected: rows.filter(
        (w) => w.status === 'rejected' || w.status === 'failed',
      ).length,
    }),
    [rows],
  );

  const stats = useMemo(() => {
    const held = rows
      .filter((w) => isHeld(w.status))
      .reduce((s, w) => s + Number(w.amountChips), 0);
    const last = rows.length > 0 ? rows[0]?.createdAt : null;
    return { held, last };
  }, [rows]);

  return (
    <>
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        {/* Header */}
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-[var(--color-gold)]">
              <ArrowUpToLine className="size-3" />
              Tus retiros
            </span>
            <h1 className="font-display text-[34px] leading-none">Mis retiros</h1>
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
            {/* Solicitar retiro — CTA en oro (lo distingue de Depositar azul). */}
            <button
              type="button"
              onClick={() => setNewOpen(true)}
              className="inline-flex h-9 items-center gap-2 rounded-[var(--radius)] px-4 text-[13px] font-semibold"
              style={{ background: 'var(--gradient-gold)', color: '#1a1206' }}
            >
              <Plus className="size-3.5" />
              Solicitar retiro
            </button>
          </div>
        </header>

        {/* Banner explicativo */}
        <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-4 py-3 text-[12px] text-[var(--color-fg-muted)]">
          <span className="font-medium text-[var(--color-fg)]">
            ¿Cómo funciona?
          </span>{' '}
          Cuando solicitás un retiro, las fichas quedan en hold (descontadas del
          balance disponible). El operador valida tus datos, paga por fuera y
          marca como pagado. Si rechaza, el hold se libera.
        </div>

        {/* 2 stats, las dos operativas — ver el aviso de arriba. */}
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <StatCard
            label="En hold"
            value={`$ ${arsFmt.format(stats.held)}`}
            accent="var(--color-gold)"
            loading={isLoading}
          />
          <StatCard
            label="Último retiro"
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
                label="Ups, no pudimos cargar tus retiros."
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
                    ? 'Todavía no solicitaste ningún retiro.'
                    : 'No hay retiros en esta categoría.'
                }
                description={
                  group === 'all'
                    ? 'Cuando pidas tu primer retiro, lo vas a ver acá con su estado.'
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
                      Solicitar el primero
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {filtered.map((w) => {
                const meta = STATUS_META[w.status];
                const Icon = meta.icon;
                return (
                  <li key={w.id} className="flex items-center gap-3 px-4 py-3.5">
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
                        Retiro #{w.id.slice(0, 4).toUpperCase()}
                      </span>
                      <span className="truncate text-[11px] text-[var(--color-fg-subtle)]">
                        {formatWhen(w.createdAt)}
                        {w.methodName || w.methodCode
                          ? ` · ${w.methodName ?? w.methodCode}`
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
                      style={{ color: meta.tone }}
                    >
                      {arsFmt.format(Number(w.amountChips))}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <NewWithdrawalModal open={newOpen} onOpenChange={setNewOpen} />
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
      timeZone: 'America/Argentina/Buenos_Aires',
      hour: '2-digit',
      minute: '2-digit',
    });
    if (sameDay) return `Hoy · ${time}`;
    const date = d.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: 'short' });
    return `${date} · ${time}`;
  } catch {
    return String(iso);
  }
}
