/**
 * /withdrawals — review queue de retiros.
 *
 * Diferencia con /deposits:
 *   - Tabs filter: Cola (pending) / Por pagar (approved) / Pagados / Resto.
 *   - "Por pagar" es la queue del operador financiero — los que ya
 *     aprobamos pero todavía no transferimos.
 *
 * Reusa los mismos primitives de /deposits (Table, Badge, Pager, drawer).
 */

'use client';

import {
  CheckCircle2,
  Clock,
  Coins,
  RefreshCw,
  Send,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { WithdrawalDetailDrawer } from '@/components/admin/withdrawal-detail-drawer';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CsvExportButton } from '@/components/ui/csv-export-button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import {
  useWithdrawals,
  type WithdrawalStatus,
} from '@/lib/hooks/use-withdrawals';
import { cn } from '@/lib/cn';

const PAGE_SIZE = 25;

const STATUS_VARIANT: Record<WithdrawalStatus, BadgeVariant> = {
  pending: 'warning',
  approved: 'info',
  processing: 'info',
  paid: 'success',
  rejected: 'danger',
  failed: 'danger',
};

const STATUS_LABEL: Record<WithdrawalStatus, string> = {
  pending: 'pendiente',
  approved: 'aprobado',
  processing: 'procesando',
  paid: 'pagado',
  rejected: 'rechazado',
  failed: 'fallido',
};

interface FilterTab {
  id: string;
  label: string;
  icon?: typeof Clock;
  statuses?: WithdrawalStatus[];
}

const FILTER_TABS: FilterTab[] = [
  { id: 'queue', label: 'Cola', icon: Clock, statuses: ['pending'] },
  { id: 'topay', label: 'Por pagar', icon: Send, statuses: ['approved', 'processing'] },
  { id: 'paid', label: 'Pagados', icon: CheckCircle2, statuses: ['paid'] },
  { id: 'rejected', label: 'Rechazados/fallidos', statuses: ['rejected', 'failed'] },
  { id: 'all', label: 'Todos' },
];

export default function WithdrawalsPage() {
  const [tabId, setTabId] = useState<string>('queue');
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const tab = useMemo(
    () => FILTER_TABS.find((t) => t.id === tabId) ?? FILTER_TABS[0]!,
    [tabId],
  );

  const { data, isLoading, isError, refetch, isFetching } = useWithdrawals({
    status: tab.statuses,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const queueCount = useWithdrawals({
    status: ['pending'],
    limit: 1,
    offset: 0,
  }).data?.total;

  const toPayCount = useWithdrawals({
    status: ['approved', 'processing'],
    limit: 1,
    offset: 0,
  }).data?.total;

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;

  return (
    <>
      <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[1600px] mx-auto">
        {/* Header */}
        <header className="flex items-end justify-between gap-6 pb-2">
          <div className="flex flex-col gap-2">
            <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
              <Coins className="size-3" />
              Operación · Retiros
            </span>
            <h1 className="font-display text-[2.5rem] leading-none tracking-tight">
              Review de retiros
            </h1>
            <p className="text-sm text-[var(--color-fg-muted)] mt-1 flex items-center gap-2 flex-wrap">
              {data ? `${rows.length} de ${total} en esta vista` : 'Cargando…'}
              {(queueCount ?? 0) > 0 && tabId !== 'queue' && (
                <>
                  <span className="text-[var(--color-fg-subtle)]">·</span>
                  <button
                    type="button"
                    onClick={() => setTabId('queue')}
                    className="text-[var(--color-accent-text)] hover:underline tabular-nums"
                  >
                    {queueCount} en cola
                  </button>
                </>
              )}
              {(toPayCount ?? 0) > 0 && tabId !== 'topay' && (
                <>
                  <span className="text-[var(--color-fg-subtle)]">·</span>
                  <button
                    type="button"
                    onClick={() => setTabId('topay')}
                    className="text-[var(--color-accent-text)] hover:underline tabular-nums"
                  >
                    {toPayCount} por pagar
                  </button>
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <CsvExportButton
              path="/tenant/withdrawals/export"
              params={{ status: tab.statuses?.join(',') }}
              filenameHint="withdrawals"
              entityLabel="retiros"
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
        <div className="flex items-center gap-px bg-[var(--color-border)] border border-[var(--color-border)] self-start flex-wrap">
          {FILTER_TABS.map((t) => {
            const Icon = t.icon;
            return (
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
                {Icon && <Icon className="size-3" />}
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Table */}
        <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
          {isLoading ? (
            <LoadingTable />
          ) : isError ? (
            <div className="p-6">
              <EmptyState
                hint="withdrawals"
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
                hint="withdrawals"
                stream={`tenant · status=${tab.statuses?.join(',') ?? '*'}`}
                label={
                  tabId === 'queue'
                    ? 'No hay retiros pendientes — todo al día'
                    : tabId === 'topay'
                    ? 'No hay retiros por pagar — buen momento para tomar un café'
                    : 'Sin retiros en este filtro'
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
                {rows.map((w, i) => (
                  <TR
                    key={w.id}
                    interactive
                    onClick={() => setSelectedId(w.id)}
                    className="animate-fade-up-staggered"
                    style={{ animationDelay: `${Math.min(i * 25, 500)}ms` }}
                  >
                    <TD>
                      <span className="font-mono text-[12px] text-[var(--color-fg-muted)]">
                        #{w.id.slice(0, 8)}
                      </span>
                    </TD>
                    <TD>
                      <div className="flex flex-col">
                        <span className="text-[13px] text-[var(--color-fg)]">
                          {w.userDisplayName ?? w.userUsername ?? '—'}
                        </span>
                        <span className="text-[10px] text-[var(--color-fg-subtle)] font-mono">
                          {w.userUsername
                            ? `@${w.userUsername}`
                            : w.userId.slice(0, 13) + '…'}
                        </span>
                      </div>
                    </TD>
                    <TD numeric>
                      <div className="flex flex-col items-end">
                        <span className="text-[13px] text-[var(--color-fg)]">
                          {w.amountChips}
                        </span>
                        <span className="text-[10px] text-[var(--color-fg-subtle)]">
                          {w.amountFiat} {w.currencyFiat}
                        </span>
                      </div>
                    </TD>
                    <TD>
                      <span className="text-[12px] text-[var(--color-fg-muted)]">
                        {w.methodName ?? w.methodCode ?? '—'}
                      </span>
                    </TD>
                    <TD>
                      <Badge variant={STATUS_VARIANT[w.status]} dot>
                        {STATUS_LABEL[w.status]}
                      </Badge>
                    </TD>
                    <TD numeric className="text-[var(--color-fg-subtle)]">
                      {formatDateTime(w.createdAt)}
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

      <WithdrawalDetailDrawer
        withdrawalId={selectedId}
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
