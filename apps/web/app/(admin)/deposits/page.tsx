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
  Bell,
  Check,
  CheckCircle2,
  Clock,
  Link2,
  RefreshCw,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { DepositDetailDrawer } from '@/components/admin/deposit-detail-drawer';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CsvExportButton } from '@/components/ui/csv-export-button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { isApiError } from '@/lib/api-client';
import {
  useApproveDeposit,
  useDeposits,
  type DepositRow,
  type DepositStatus,
} from '@/lib/hooks/use-deposits';
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
  // Sprint 51.7: polling auto + tracking de nuevos pendientes que
  // entraron mientras el operador miraba la pantalla.
  const [autoRefresh, setAutoRefresh] = useState(true);
  const previousTotalRef = useRef<number | null>(null);
  const [newSinceLastView, setNewSinceLastView] = useState(0);

  const tab = useMemo(
    () => FILTER_TABS.find((t) => t.id === tabId) ?? FILTER_TABS[0]!,
    [tabId],
  );

  // Polling solo en la tab 'queue' (donde el operador está esperando
  // trabajo nuevo). En otras tabs, no tiene sentido refrescar auto.
  const pollingInterval = tabId === 'queue' && autoRefresh ? 15_000 : false;

  const { data, isLoading, isError, refetch, isFetching } = useDeposits(
    {
      status: tab.statuses,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    },
    { refetchInterval: pollingInterval },
  );

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const queueCount = useDeposits({
    status: ['pending', 'under_review'],
    limit: 1,
    offset: 0,
  }).data?.total;

  // Sprint 51.7: cuando llega un fetch nuevo y el total subió, marcar
  // que hay rows nuevas. El operador puede ver el banner y darse cuenta
  // sin perderse depositos pendientes.
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

  // Limpiar contador cuando el operador cambia de tab o resetea.
  useEffect(() => {
    setNewSinceLastView(0);
    previousTotalRef.current = null;
  }, [tabId]);

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
            {/* Sprint 51.7: toggle de auto-refresh — solo visible en la
                tab queue donde tiene sentido. */}
            {tabId === 'queue' && (
              <button
                type="button"
                onClick={() => setAutoRefresh((v) => !v)}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 h-8 text-[11px] uppercase tracking-[0.08em] font-medium border transition-colors',
                  autoRefresh
                    ? 'bg-[var(--color-success-bg)] text-[var(--color-success)] border-[var(--color-success)]'
                    : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] border-[var(--color-border)] hover:border-[var(--color-border-strong)]',
                )}
                title={
                  autoRefresh
                    ? 'Refrescando cada 15s — click para pausar'
                    : 'Click para activar refresh automático'
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
                Auto {autoRefresh ? 'ON' : 'OFF'}
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
          </div>
        </header>

        {/* Sprint 51.7: banner cuando hay rows nuevas — el operador puede
            no estar mirando el momento exacto en que entran. */}
        {newSinceLastView > 0 && tabId === 'queue' && (
          <button
            type="button"
            onClick={() => {
              refetch();
              setNewSinceLastView(0);
            }}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-[var(--color-accent-subtle)] border border-[var(--color-accent)] text-[12px] text-[var(--color-fg)] hover:bg-[var(--color-accent)] hover:text-[var(--color-accent-fg)] transition-colors"
          >
            <Bell className="size-3.5" />
            <span className="font-medium">
              {newSinceLastView}{' '}
              {newSinceLastView === 1 ? 'depósito nuevo' : 'depósitos nuevos'}
            </span>
            <span className="text-[10px] uppercase tracking-[0.08em] opacity-70">
              click para ver
            </span>
          </button>
        )}

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
                  {tabId === 'queue' && <TH align="right">Acción</TH>}
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
                    {tabId === 'queue' && (
                      <TD numeric>
                        <QuickApproveCell deposit={d} />
                      </TD>
                    )}
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

/**
 * Sprint 51.7: celda con quick-approve inline. Si el deposit YA tiene
 * bank_tx matcheada (el empleado de confianza pre-matcheó), un solo
 * click aprueba sin abrir drawer. Confirm visual con doble-click pattern
 * para evitar misclicks.
 *
 * Si no tiene bank_tx, muestra badge "Falta match" — el operador debe
 * abrir el drawer para matchear primero.
 */
function QuickApproveCell({ deposit }: { deposit: DepositRow }) {
  const approve = useApproveDeposit(deposit.id);
  const [confirming, setConfirming] = useState(false);
  const hasMatch = !!deposit.bankTransactionId;

  const handleClick = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation(); // no abrir drawer.
    if (!hasMatch) return;
    if (!confirming) {
      setConfirming(true);
      // Reset confirmation después de 3s sin click.
      setTimeout(() => setConfirming(false), 3000);
      return;
    }
    try {
      const res = await approve.mutateAsync();
      toast.success('Depósito aprobado', {
        description: `${res.deposit.amountChips} chips acreditadas.`,
      });
    } catch (err) {
      toast.error('No se pudo aprobar', { description: mapQuickError(err) });
    } finally {
      setConfirming(false);
    }
  };

  if (!hasMatch) {
    return (
      <span
        className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] italic"
        title="Abrí el drawer para matchear una transferencia bancaria primero"
      >
        falta match
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={approve.isPending}
      className={cn(
        'inline-flex items-center gap-1 px-2 h-7 text-[11px] uppercase tracking-[0.06em] font-medium border transition-colors',
        confirming
          ? 'bg-[var(--color-success)] text-[var(--color-accent-fg)] border-[var(--color-success)]'
          : 'bg-[var(--color-success-bg)] text-[var(--color-success)] border-[var(--color-success)] hover:bg-[var(--color-success)] hover:text-[var(--color-accent-fg)]',
      )}
    >
      {approve.isPending ? (
        <>
          <span className="size-2.5 border-2 border-current border-r-transparent animate-spin rounded-full" />
          ...
        </>
      ) : confirming ? (
        <>
          <Check className="size-3" />
          Confirmar
        </>
      ) : (
        <>
          <Link2 className="size-3" />
          Aprobar
        </>
      )}
    </button>
  );
}

function mapQuickError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.status === 400 && err.code === 'DEPOSIT_REQUIRES_BANK_TX') {
    return 'El deposit perdió el match — abrí el drawer y re-asignalo.';
  }
  if (err.status === 409) return 'Ya fue resuelto por otro operador.';
  return err.message || 'Error inesperado.';
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
