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
  ArrowUpFromLine,
  Bell,
  CheckCircle2,
  Clock,
  RefreshCw,
  Send,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { WithdrawalDetailDrawer } from '@/components/admin/withdrawal-detail-drawer';
import { WithdrawalCardList } from '@/components/admin/withdrawal-card-list';
import {
  RequestFiltersBar,
  requestFiltersToParams,
  EMPTY_REQUEST_FILTERS,
  type RequestFilters,
} from '@/components/admin/request-filters-bar';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CsvExportButton } from '@/components/ui/csv-export-button';
import { EmptyState } from '@/components/ui/empty-state';
import { HelpNote } from '@/components/ui/help-note';
import { KpiTile } from '@/components/ui/kpi-tile';
import { PageHeader } from '@/components/ui/page-header';
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { arStartOfDayIso, arTodayDateStr } from '@/lib/format-date';
import {
  useWithdrawals,
  type WithdrawalStatus,
} from '@/lib/hooks/use-withdrawals';
import { usePaymentMethods } from '@/lib/hooks/use-payment-methods';
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
  // Fase B: polling auto en la cola + tracking de retiros nuevos que
  // entraron mientras el operador miraba la pantalla (mismo patrón que
  // /deposits).
  const [autoRefresh, setAutoRefresh] = useState(true);
  const previousTotalRef = useRef<number | null>(null);
  const [newSinceLastView, setNewSinceLastView] = useState(0);

  // Filtros de la barra (aplican a la lista Y al export CSV).
  const [reqFilters, setReqFilters] = useState<RequestFilters>(
    EMPTY_REQUEST_FILTERS,
  );
  const methods = usePaymentMethods(false).data?.data ?? [];
  const reqParams = useMemo(
    () => requestFiltersToParams(reqFilters),
    [reqFilters],
  );
  const patchFilters = (patch: Partial<RequestFilters>) => {
    setReqFilters((f) => ({ ...f, ...patch }));
    setPage(0);
  };

  const tab = useMemo(
    () => FILTER_TABS.find((t) => t.id === tabId) ?? FILTER_TABS[0]!,
    [tabId],
  );

  // Polling solo en la tab 'queue' (cola de trabajo del operador).
  const pollingInterval = tabId === 'queue' && autoRefresh ? 15_000 : false;

  const { data, isLoading, isError, refetch, isFetching } = useWithdrawals(
    {
      status: tab.statuses,
      fromDate: reqParams.fromDate,
      toDate: reqParams.toDate,
      methodId: reqParams.methodId,
      matched:
        reqParams.matched === 'yes'
          ? true
          : reqParams.matched === 'no'
            ? false
            : undefined,
      userSearch: reqParams.userSearch,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    },
    { refetchInterval: pollingInterval },
  );

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

  const paidTodayCount = useWithdrawals({
    status: ['paid'],
    fromDate: arStartOfDayIso(arTodayDateStr()),
    limit: 1,
    offset: 0,
  }).data?.total;

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;

  // Fase B: cuando llega un fetch nuevo y el total de la cola subió,
  // marcar que hay retiros nuevos para que el operador lo vea.
  useEffect(() => {
    if (data?.total === undefined) return;
    if (previousTotalRef.current === null) {
      previousTotalRef.current = data.total;
      return;
    }
    if (tabId === 'queue' && data.total > previousTotalRef.current) {
      const delta = data.total - previousTotalRef.current;
      setNewSinceLastView((prev) => prev + delta);
    }
    previousTotalRef.current = data.total;
  }, [data?.total, tabId]);

  // Resetear el contador al cambiar de tab.
  useEffect(() => {
    setNewSinceLastView(0);
    previousTotalRef.current = null;
  }, [tabId]);

  return (
    <>
      <PageShell>
        <PageHeader
          icon={ArrowUpFromLine}
          title="Retiros"
          description={
            <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>Revisá, aprobá y pagá los pedidos de retiro de los jugadores.</span>
              {data && (
                <span className="text-[var(--color-fg-subtle)]">
                  {rows.length} de {total} en esta vista
                </span>
              )}
            </span>
          }
          actions={
            <>
              <CsvExportButton
                path="/tenant/withdrawals/export"
                params={{ status: tab.statuses?.join(','), ...reqParams }}
                filenameHint="withdrawals"
                permission="withdrawals.export"
                entityLabel="retiros"
              />
              {/* Toggle de auto-refresco — solo en la Cola, donde el operador
                  está esperando trabajo nuevo. */}
              {tabId === 'queue' && (
                <button
                  type="button"
                  onClick={() => setAutoRefresh((v) => !v)}
                  className={cn(
                    'flex items-center gap-1.5 px-2.5 h-8 rounded-[var(--radius-sm)] text-[11px] uppercase tracking-[0.08em] font-medium border transition-colors',
                    autoRefresh
                      ? 'bg-[var(--color-success-bg)] text-[var(--color-success)] border-[var(--color-success)]/40'
                      : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] border-[var(--color-border)] hover:border-[var(--color-border-strong)]',
                  )}
                  title={
                    autoRefresh
                      ? 'Se actualiza sola cada 15s — click para pausar'
                      : 'Click para actualizar sola cada 15s'
                  }
                >
                  <span
                    className={cn(
                      'size-1.5 rounded-full',
                      autoRefresh
                        ? 'bg-[var(--color-success)] animate-pulse'
                        : 'bg-[var(--color-fg-subtle)]',
                    )}
                  />
                  Auto {autoRefresh ? 'activo' : 'pausado'}
                </button>
              )}
              <Button
                variant="secondary"
                size="md"
                onClick={() => {
                  refetch();
                  setNewSinceLastView(0);
                }}
                disabled={isFetching}
              >
                <RefreshCw
                  className={cn('size-3.5', isFetching && 'animate-spin')}
                />
                Refrescar
              </Button>
            </>
          }
        />

        <HelpNote id="withdrawals">
          Cuando un jugador pide sacar su plata, el retiro aparece acá en la{' '}
          <strong>Cola</strong>. Lo revisás y lo <strong>aprobás</strong> (o lo{' '}
          <strong>rechazás</strong>). Al aprobarlo pasa a <strong>Por pagar</strong>:
          ahí hacés la transferencia real al jugador y recién entonces lo marcás
          como <strong>Pagado</strong>. Todo eso lo hacés tocando el retiro para
          abrir su detalle. Con <strong>Auto</strong> la lista se actualiza sola
          cada 15 segundos.
        </HelpNote>

        {/* 3 tarjetas de estado (handoff). Clickeables → saltan al tab. */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            type="button"
            onClick={() => { setTabId('queue'); setPage(0); }}
            className="text-left w-full"
          >
            <KpiTile
              label="En cola"
              icon={Clock}
              tone="warning"
              value={queueCount ?? '—'}
              hint="esperando revisión"
              className="h-full hover:border-[var(--color-border-strong)] transition-colors"
            />
          </button>
          <button
            type="button"
            onClick={() => { setTabId('topay'); setPage(0); }}
            className="text-left w-full"
          >
            <KpiTile
              label="Por pagar"
              icon={Send}
              tone="info"
              value={toPayCount ?? '—'}
              hint="aprobados sin transferir"
              className="h-full hover:border-[var(--color-border-strong)] transition-colors"
            />
          </button>
          <button
            type="button"
            onClick={() => { setTabId('paid'); setPage(0); }}
            className="text-left w-full"
          >
            <KpiTile
              label="Pagado hoy"
              icon={CheckCircle2}
              tone="success"
              value={paidTodayCount ?? '—'}
              hint="transferidos hoy"
              className="h-full hover:border-[var(--color-border-strong)] transition-colors"
            />
          </button>
        </div>

        {/* Fase B: banner cuando hay retiros nuevos en la cola. */}
        {newSinceLastView > 0 && tabId === 'queue' && (
          <button
            type="button"
            onClick={() => {
              refetch();
              setNewSinceLastView(0);
            }}
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-[var(--radius-sm)] bg-[var(--color-accent-subtle)] border border-[var(--color-accent-border)] text-[12px] text-[var(--color-fg)] hover:bg-[var(--color-accent)] hover:text-[var(--color-accent-fg)] transition-colors"
          >
            <Bell className="size-3.5" />
            <span className="font-medium">
              {newSinceLastView}{' '}
              {newSinceLastView === 1 ? 'retiro nuevo' : 'retiros nuevos'}
            </span>
            <span className="text-[10px] uppercase tracking-[0.08em] opacity-70">
              click para ver
            </span>
          </button>
        )}

        {/* Tabs filter */}
        <div className="flex items-center gap-px bg-[var(--color-border)] border border-[var(--color-border)] rounded-[var(--radius-sm)] overflow-x-auto hide-scrollbar max-w-full sm:self-start">
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
                  'shrink-0 whitespace-nowrap px-4 h-8 text-[11px] uppercase tracking-[0.08em] font-medium flex items-center gap-1.5',
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

        {/* Filtros (aplican a la lista y al CSV). */}
        <RequestFiltersBar
          filters={reqFilters}
          onChange={patchFilters}
          methods={methods}
          matchedLabel="transferencia"
        />

        {/* Fase 2: card list mobile (< lg). La tabla desktop queda
            intacta y se oculta en pantallas chicas. */}
        <div className="flex flex-col gap-3 lg:hidden">
          {isLoading ? (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton
                  key={i}
                  className="h-44 w-full rounded-[var(--radius)] bg-[var(--color-bg-subtle)]"
                />
              ))}
            </div>
          ) : isError ? (
            <div className="p-6 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius)]">
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
            <div className="p-6 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius)]">
              <EmptyState
                hint="withdrawals"
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
            <WithdrawalCardList
              rows={rows}
              tabId={tabId}
              onOpenDetail={setSelectedId}
            />
          )}
        </div>

        {/* Table (desktop) */}
        <div className="hidden lg:block bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius)] overflow-hidden">
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
      </PageShell>

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
    <div className="flex flex-wrap items-center justify-end gap-3 text-[11px] text-[var(--color-fg-subtle)]">
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
      timeZone: 'America/Argentina/Buenos_Aires',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
