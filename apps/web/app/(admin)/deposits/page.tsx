/**
 * /deposits — review queue de depósitos para el operador.
 *
 * Composición:
 *   - Header con título + count.
 *   - Toolbar: tabs filter de status + refresh.
 *   - Tabla: id, user, amount, method, status badge, fecha.
 *   - Click row → drawer detalle con acciones approve/reject.
 *
 * Default filter: status=['pending', 'under_review'] — la queue de
 * trabajo del operador. Cambiar tab muestra otros estados.
 */

'use client';

import {
  ArrowLeftRight,
  CheckCircle2,
  Clock,
  RefreshCw,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { DepositDetailDrawer } from '@/components/admin/deposit-detail-drawer';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CsvExportButton } from '@/components/ui/csv-export-button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { useDeposits, type DepositStatus } from '@/lib/hooks/use-deposits';
import { cn } from '@/lib/cn';

const PAGE_SIZE = 25;

const STATUS_VARIANT: Record<DepositStatus, BadgeVariant> = {
  pending: 'warning',
  under_review: 'info',
  approved: 'success',
  rejected: 'danger',
  expired: 'neutral',
  cancelled: 'neutral',
};

const STATUS_LABEL: Record<DepositStatus, string> = {
  pending: 'pendiente',
  under_review: 'en revisión',
  approved: 'aprobado',
  rejected: 'rechazado',
  expired: 'expirado',
  cancelled: 'cancelado',
};

interface FilterTab {
  id: string;
  label: string;
  statuses?: DepositStatus[];
}

const FILTER_TABS: FilterTab[] = [
  { id: 'queue', label: 'Cola', statuses: ['pending', 'under_review'] },
  { id: 'approved', label: 'Aprobados', statuses: ['approved'] },
  { id: 'rejected', label: 'Rechazados', statuses: ['rejected'] },
  { id: 'all', label: 'Todos' },
];

export default function DepositsPage() {
  const [tabId, setTabId] = useState<string>('queue');
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const tab = useMemo(
    () => FILTER_TABS.find((t) => t.id === tabId) ?? FILTER_TABS[0]!,
    [tabId],
  );

  const { data, isLoading, isError, refetch, isFetching } = useDeposits({
    status: tab.statuses,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const queueCount = useDeposits({
    status: ['pending', 'under_review'],
    limit: 1,
    offset: 0,
  }).data?.total;

  return (
    <>
      <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[1600px] mx-auto">
        {/* Header */}
        <header className="flex items-end justify-between gap-6 pb-2">
          <div className="flex flex-col gap-2">
            <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
              <ArrowLeftRight className="size-3" />
              Operación · Depósitos
            </span>
            <h1 className="font-display text-[2.5rem] leading-none tracking-tight">
              Review de depósitos
            </h1>
            <p className="text-sm text-[var(--color-fg-muted)] mt-1">
              {data
                ? `${rows.length} de ${total} en esta vista`
                : 'Cargando…'}
              {queueCount !== undefined && tabId !== 'queue' && queueCount > 0 && (
                <>
                  {' · '}
                  <button
                    type="button"
                    onClick={() => setTabId('queue')}
                    className="text-[var(--color-accent-text)] hover:underline tabular-nums"
                  >
                    {queueCount} en cola
                  </button>
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <CsvExportButton
              path="/tenant/deposits/export"
              params={{ status: tab.statuses?.join(',') }}
              filenameHint="deposits"
              entityLabel="depósitos"
            />
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
          </div>
        </header>

        {/* Tabs filter */}
        <div className="flex items-center gap-px bg-[var(--color-border)] border border-[var(--color-border)] self-start">
          {FILTER_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTabId(t.id);
                setPage(0);
              }}
              className={cn(
                'px-4 h-8 text-[11px] uppercase tracking-[0.08em] font-medium flex items-center gap-1.5',
                'transition-colors duration-150',
                tabId === t.id
                  ? 'bg-[var(--color-bg)] text-[var(--color-fg)] border-b-2 border-b-[var(--color-accent)]'
                  : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]',
              )}
            >
              {t.id === 'queue' && <Clock className="size-3" />}
              {t.id === 'approved' && <CheckCircle2 className="size-3" />}
              {t.label}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
          {isLoading ? (
            <LoadingTable />
          ) : isError ? (
            <div className="p-6">
              <EmptyState
                hint="deposits"
                label="No se pudo cargar la lista."
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => refetch()}
                  >
                    Reintentar
                  </Button>
                }
              />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-6">
              <EmptyState
                hint="deposits"
                stream={`tenant · status=${tab.statuses?.join(',') ?? '*'}`}
                label={
                  tabId === 'queue'
                    ? 'No hay depósitos pendientes — todo al día'
                    : 'Sin depósitos en este filtro'
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>ID</TH>
                  <TH>Usuario</TH>
                  <TH align="right">Monto</TH>
                  <TH>Método</TH>
                  <TH>Estado</TH>
                  <TH align="right">Creado</TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((d, i) => (
                  <TR
                    key={d.id}
                    interactive
                    onClick={() => setSelectedId(d.id)}
                    className="animate-fade-up-staggered"
                    style={{ animationDelay: `${Math.min(i * 25, 500)}ms` }}
                  >
                    <TD>
                      <span className="font-mono text-[12px] text-[var(--color-fg-muted)]">
                        #{d.id.slice(0, 8)}
                      </span>
                    </TD>
                    <TD>
                      <div className="flex flex-col">
                        <span className="text-[13px] text-[var(--color-fg)]">
                          {d.userDisplayName ?? d.userUsername ?? '—'}
                        </span>
                        <span className="text-[10px] text-[var(--color-fg-subtle)] font-mono">
                          {d.userUsername
                            ? `@${d.userUsername}`
                            : d.userId.slice(0, 13) + '…'}
                        </span>
                      </div>
                    </TD>
                    <TD numeric>
                      <div className="flex flex-col items-end">
                        <span className="text-[13px] text-[var(--color-fg)]">
                          {d.amountChips}
                        </span>
                        <span className="text-[10px] text-[var(--color-fg-subtle)]">
                          {d.amountFiat} {d.currencyFiat}
                        </span>
                      </div>
                    </TD>
                    <TD>
                      <span className="font-mono text-[12px] text-[var(--color-fg-muted)]">
                        {d.methodCode ?? d.methodId.slice(0, 8)}
                      </span>
                    </TD>
                    <TD>
                      <Badge variant={STATUS_VARIANT[d.status]} dot>
                        {STATUS_LABEL[d.status]}
                      </Badge>
                    </TD>
                    <TD numeric className="text-[var(--color-fg-subtle)]">
                      {formatDateTime(d.createdAt)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>

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

      <DepositDetailDrawer
        depositId={selectedId}
        open={!!selectedId}
        onOpenChange={(o) => !o && setSelectedId(null)}
      />
    </>
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
          ← Prev
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!hasMore}
          className="px-3 h-7 text-[11px] uppercase tracking-[0.08em] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

function LoadingTable() {
  return (
    <div className="p-4 flex flex-col gap-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full bg-[var(--color-bg-subtle)]" />
      ))}
    </div>
  );
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('es-AR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
