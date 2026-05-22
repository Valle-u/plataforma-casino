/**
 * /play/bonuses — mis bonos.
 *
 * Composición:
 *   - Header con counter.
 *   - Tabs: Activos / Liberados / Historial completo.
 *   - Grid de cards de bono: nombre + tipo + remaining/granted + barra de
 *     progreso + fecha de expiración.
 *
 * Endpoint:
 *   - GET /tenant/bonuses/me?statuses=&limit=&offset=
 *
 * Sin acciones por ahora (cancelar/usar) — los flows interactivos
 * (wagering progress, force_clear admin) llegan después.
 */

'use client';

import { Calendar, Gift, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useMyBonuses,
  type BonusRow,
  type BonusStatus,
} from '@/lib/hooks/use-bonuses';
import { cn } from '@/lib/cn';

const PAGE_SIZE = 20;

const STATUS_VARIANT: Record<BonusStatus, BadgeVariant> = {
  active: 'success',
  pending: 'warning',
  cleared: 'success',
  cancelled: 'neutral',
  expired: 'neutral',
  force_cleared: 'info',
};

const STATUS_LABEL: Record<BonusStatus, string> = {
  active: 'activo',
  pending: 'pendiente',
  cleared: 'liberado',
  cancelled: 'cancelado',
  expired: 'expirado',
  force_cleared: 'liberado',
};

interface Tab {
  id: string;
  label: string;
  statuses?: BonusStatus[];
}

const TABS: Tab[] = [
  { id: 'active', label: 'Activos', statuses: ['active', 'pending'] },
  { id: 'cleared', label: 'Liberados', statuses: ['cleared', 'force_cleared'] },
  { id: 'all', label: 'Historial' },
];

export default function PlayBonusesPage() {
  const [tabId, setTabId] = useState<string>('active');
  const [page, setPage] = useState(0);

  const tab = useMemo(() => TABS.find((t) => t.id === tabId) ?? TABS[0]!, [tabId]);

  const { data, isLoading, isError, refetch, isFetching } = useMyBonuses({
    statuses: tab.statuses,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-10 flex flex-col gap-8">
      {/* Header */}
      <header className="flex items-end justify-between gap-6 pb-2">
        <div className="flex flex-col gap-2">
          <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
            <Gift className="size-3" />
            Tus bonos
          </span>
          <h1 className="font-display text-[2.5rem] leading-none tracking-tight">
            Mis bonos
          </h1>
          <p className="text-sm text-[var(--color-fg-muted)] mt-1">
            {data ? `${rows.length} de ${total} en esta vista` : 'Cargando…'}
          </p>
        </div>
        <Button
          variant="secondary"
          size="md"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw
            className={cn('size-3.5', isFetching && 'animate-spin')}
          />
          Refrescar
        </Button>
      </header>

      {/* Tabs */}
      <div className="flex items-center gap-px bg-[var(--color-border)] border border-[var(--color-border)] self-start">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTabId(t.id);
              setPage(0);
            }}
            className={cn(
              'px-4 h-8 text-[11px] uppercase tracking-[0.08em] font-medium',
              'transition-colors duration-150',
              tabId === t.id
                ? 'bg-[var(--color-bg)] text-[var(--color-fg)] border-b-2 border-b-[var(--color-accent)]'
                : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Grid de bonos */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-48 w-full bg-[var(--color-bg-subtle)]"
            />
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          hint="my_bonuses"
          label="No se pudieron cargar tus bonos."
          action={
            <Button variant="secondary" size="sm" onClick={() => refetch()}>
              Reintentar
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          hint="my_bonuses"
          label={
            tabId === 'active'
              ? 'No tenés bonos activos en este momento'
              : 'Sin bonos en este filtro'
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {rows.map((bonus, i) => (
            <BonusCard
              key={bonus.id}
              bonus={bonus}
              delay={Math.min(i * 50, 600)}
            />
          ))}
        </div>
      )}

      {/* Pager */}
      {data && total > PAGE_SIZE && (
        <Pager
          page={page}
          total={total}
          onPrev={() => setPage((p) => Math.max(0, p - 1))}
          onNext={() => setPage((p) => p + 1)}
          hasMore={(page + 1) * PAGE_SIZE < total}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// BonusCard
// ──────────────────────────────────────────────────────────────────────

function BonusCard({ bonus, delay }: { bonus: BonusRow; delay: number }) {
  const granted = Number(bonus.grantedAmount);
  const remaining = Number(bonus.remainingAmount);
  const progress = granted > 0 ? Math.max(0, Math.min(100, (remaining / granted) * 100)) : 0;
  const expired = bonus.status === 'expired';
  const cleared = bonus.status === 'cleared' || bonus.status === 'force_cleared';
  const cancelled = bonus.status === 'cancelled';

  return (
    <article
      className={cn(
        'animate-fade-up-staggered',
        'border border-[var(--color-border)] bg-[var(--color-bg-elevated)]',
        'flex flex-col gap-4 p-5',
        'transition-colors hover:border-[var(--color-border-strong)]',
        (expired || cancelled) && 'opacity-70',
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Top: name + type + status */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <span className="text-[14px] font-medium text-[var(--color-fg)] tracking-tight truncate">
            {bonus.definitionName ?? bonus.definitionCode ?? 'Bono'}
          </span>
          {bonus.definitionType && (
            <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] font-mono">
              {bonus.definitionType}
            </span>
          )}
        </div>
        <Badge variant={STATUS_VARIANT[bonus.status]} dot>
          {STATUS_LABEL[bonus.status]}
        </Badge>
      </div>

      {/* Amounts */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] font-medium">
            Restante
          </span>
          <div className="flex items-baseline gap-1">
            <span className="font-display text-2xl tabular-nums text-[var(--color-fg)] leading-none">
              {Number(bonus.remainingAmount).toLocaleString('es-AR')}
            </span>
            <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-mono">
              chips
            </span>
          </div>
        </div>
        {/* Progress bar (remaining / granted) */}
        <div className="h-1 bg-[var(--color-bg)] border border-[var(--color-border)] overflow-hidden">
          <div
            className={cn(
              'h-full transition-all',
              cleared
                ? 'bg-[var(--color-success)]'
                : cancelled || expired
                  ? 'bg-[var(--color-fg-subtle)]'
                  : 'bg-[var(--color-accent)]',
            )}
            style={{ width: `${cleared ? 100 : progress}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[10px] text-[var(--color-fg-subtle)] font-mono">
          <span>
            otorgado: {Number(bonus.grantedAmount).toLocaleString('es-AR')}
          </span>
          <span className="tabular-nums">{Math.round(progress)}%</span>
        </div>
      </div>

      {/* Footer: fechas */}
      <div className="flex items-center justify-between text-[10px] text-[var(--color-fg-subtle)] font-mono pt-2 border-t border-[var(--color-border)]">
        <div className="flex items-center gap-1.5">
          <Calendar className="size-3" />
          <span>otorgado {formatDate(bonus.grantedAt)}</span>
        </div>
        {bonus.expiresAt && (
          <span
            className={cn(
              'uppercase tracking-[0.08em]',
              expired
                ? 'text-[var(--color-accent-text)]'
                : 'text-[var(--color-fg-subtle)]',
            )}
          >
            {expired ? 'expirado' : `expira ${formatDate(bonus.expiresAt)}`}
          </span>
        )}
      </div>
    </article>
  );
}

function Pager({
  page,
  total,
  onPrev,
  onNext,
  hasMore,
}: {
  page: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  hasMore: boolean;
}) {
  const start = page * PAGE_SIZE + 1;
  const end = Math.min(start + PAGE_SIZE - 1, total);
  return (
    <div className="flex items-center justify-end gap-3 text-[11px] text-[var(--color-fg-subtle)]">
      <span className="font-mono tabular-nums">
        {total === 0 ? '—' : `${start}–${end} de ${total}`}
      </span>
      <div className="flex items-center gap-px bg-[var(--color-border)]">
        <button
          type="button"
          onClick={onPrev}
          disabled={page === 0}
          className="px-3 h-7 text-[11px] uppercase tracking-[0.08em] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Anterior
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!hasMore}
          className="px-3 h-7 text-[11px] uppercase tracking-[0.08em] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('es-AR', {
      day: '2-digit',
      month: 'short',
    });
  } catch {
    return iso;
  }
}
