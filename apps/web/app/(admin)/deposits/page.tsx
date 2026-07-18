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
  ExternalLink,
  Eye,
  FileText,
  ImageOff,
  Link2,
  MoreHorizontal,
  Paperclip,
  RefreshCw,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { DepositDetailDrawer } from '@/components/admin/deposit-detail-drawer';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmWithReasonModal } from '@/components/ui/confirm-with-reason-modal';
import { CsvExportButton } from '@/components/ui/csv-export-button';
import { EmptyState } from '@/components/ui/empty-state';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { isApiError } from '@/lib/api-client';
import { hasPermission, useAuth } from '@/lib/auth-context';
import {
  useApproveDeposit,
  useDeposits,
  useRejectDeposit,
  useReviewDeposit,
  type DepositRow,
  type DepositStatus,
} from '@/lib/hooks/use-deposits';
import { useActiveBonusDefinitions } from '@/lib/hooks/use-bonuses';
import {
  useMatchBankTransaction,
  useUnmatchedForAmount,
  type BankTransaction,
} from '@/lib/hooks/use-bank-transactions';
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
  const { user: actor } = useAuth();
  const canApprove = hasPermission(actor, 'deposits.approve');
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
                  <TH align="center">Comp.</TH>
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
                    <TD align="center">
                      <ReceiptQuickPeek
                        url={d.receiptUrl}
                        storageKey={d.receiptStorageKey}
                      />
                    </TD>
                    <TD>
                      <Badge variant={STATUS_VARIANT[d.status]} dot>
                        {STATUS_LABEL[d.status]}
                      </Badge>
                    </TD>
                    <TD numeric className="text-[var(--color-fg-subtle)]">
                      {formatDateTime(d.createdAt)}
                    </TD>
                    {tabId === 'queue' && canApprove && (
                      <TD numeric>
                        <DepositActionsCell
                          deposit={d}
                          onViewDetail={() => setSelectedId(d.id)}
                        />
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

/**
 * DepositActionsCell — barra de acciones inline en cada fila de la tabla.
 *
 * Botones:
 *   - Matchear (azul): abre modal para matchear con transferencia bancaria.
 *   - Aprobar (verde): abre popover con selector de bono + confirmar.
 *   - Rechazar (rojo): abre modal de motivo.
 *   - En revisión (naranja): marca como under_review.
 *   - Comprobante (ícono): abre en nueva pestaña.
 *   - Menú (dots): abre el drawer detalle.
 *
 * El botón Aprobar solo se habilita cuando el depósito tiene bank_tx matcheada.
 */
function DepositActionsCell({
  deposit,
  onViewDetail,
}: {
  deposit: DepositRow;
  onViewDetail: () => void;
}) {
  const approve = useApproveDeposit(deposit.id);
  const reject = useRejectDeposit(deposit.id);
  const review = useReviewDeposit(deposit.id);
  const { data: bonusDefsRes } = useActiveBonusDefinitions();
  const bonusDefs = bonusDefsRes?.data ?? [];

  const [showApprovePopover, setShowApprovePopover] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showMatchModal, setShowMatchModal] = useState(false);
  const [selectedBonusId, setSelectedBonusId] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [popoverPos, setPopoverPos] = useState<{ top: number; right: number } | null>(null);
  const approveBtnRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const hasMatch = !!deposit.bankTransactionId;

  const closePopover = useCallback(() => {
    setShowApprovePopover(false);
    setConfirming(false);
    setSelectedBonusId('');
    setPopoverPos(null);
  }, []);

  // Close popover on outside click
  useEffect(() => {
    if (!showApprovePopover) return;
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        closePopover();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showApprovePopover, closePopover]);

  const handleApprove = async () => {
    if (!hasMatch) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    try {
      const res = await approve.mutateAsync(selectedBonusId || undefined);
      toast.success('Depósito aprobado', {
        description: `${res.deposit.amountChips} fichas acreditadas.`,
      });
      closePopover();
    } catch (err) {
      toast.error('No se pudo aprobar', { description: mapQuickError(err) });
    }
  };

  const handleReject = async (reason: string) => {
    try {
      await reject.mutateAsync({ reason });
      toast.success('Depósito rechazado');
      setShowRejectModal(false);
    } catch (err) {
      toast.error('No se pudo rechazar', { description: mapQuickError(err) });
    }
  };

  const handleReview = async () => {
    try {
      await review.mutateAsync();
      toast.success('Marcado en revisión');
    } catch (err) {
      toast.error('No se pudo marcar', { description: mapQuickError(err) });
    }
  };

  return (
    <div className="flex items-center justify-end gap-1 relative" onClick={(e) => e.stopPropagation()}>
      {/* Match button — only when no match yet */}
      {!hasMatch && (
        <button
          type="button"
          onClick={() => setShowMatchModal(true)}
          className="inline-flex items-center gap-1 px-2 h-7 text-[10px] uppercase tracking-[0.06em] font-medium border transition-colors bg-[var(--color-info-bg)] text-[var(--color-info)] border-[var(--color-info)] hover:bg-[var(--color-info)] hover:text-white"
          title="Matchear con transferencia bancaria"
        >
          <Link2 className="size-3" />
          Match
        </button>
      )}

      {/* Approve button + popover */}
      <div className="relative">
        <button
          type="button"
          ref={approveBtnRef}
          onClick={() => {
            if (!hasMatch) {
              toast.error('Falta match', { description: 'Matcheá una transferencia bancaria primero.' });
              return;
            }
            if (showApprovePopover) {
              closePopover();
            } else {
              const rect = approveBtnRef.current?.getBoundingClientRect();
              if (rect) {
                setPopoverPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
              }
              setShowApprovePopover(true);
              setConfirming(false);
            }
          }}
          disabled={approve.isPending}
          className={cn(
            'inline-flex items-center justify-center size-10 rounded border transition-colors',
            hasMatch
              ? 'bg-[var(--color-success-bg)] text-[var(--color-success)] border-[var(--color-success)] hover:bg-[var(--color-success)] hover:text-white'
              : 'bg-[var(--color-bg-subtle)] text-[var(--color-fg-subtle)] border-[var(--color-border)] opacity-40 cursor-not-allowed',
            showApprovePopover && 'bg-[var(--color-success)] text-white',
            approve.isPending && 'opacity-50 cursor-not-allowed',
          )}
          title={hasMatch ? 'Aprobar depósito' : 'Matcheá una transferencia primero'}
        >
          {approve.isPending ? (
            <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
          ) : (
            <Check className="size-3.5" />
          )}
        </button>

        {/* Bonus popover — portal to escape table overflow */}
        {showApprovePopover && popoverPos && createPortal(
          <div
            ref={popoverRef}
            className="fixed z-[9999] w-64 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] shadow-lg p-3 flex flex-col gap-2.5"
            style={{ top: popoverPos.top, right: popoverPos.right }}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-[0.1em] font-medium text-[var(--color-fg-muted)]">
                Aprobar depósito
              </span>
              <button
                type="button"
                onClick={closePopover}
                className="text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
              >
                <X className="size-3" />
              </button>
            </div>

            {/* Bonus selector */}
            {bonusDefs.length > 0 && (
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
                  Bono (opcional)
                </label>
                <Select
                  value={selectedBonusId}
                  onChange={(e) => setSelectedBonusId(e.target.value)}
                  className="h-8 text-[12px]"
                >
                  <option value="">Sin bono</option>
                  {bonusDefs.map((bd) => {
                    const rawPct = bd.config.matchPct as number | undefined;
                    return (
                      <option key={bd.id} value={bd.id}>
                        {bd.name} ({rawPct ?? '?'}%)
                      </option>
                    );
                  })}
                </Select>
              </div>
            )}

            {/* Confirm button */}
            <button
              type="button"
              onClick={handleApprove}
              disabled={approve.isPending}
              className={cn(
                'w-full flex items-center justify-center gap-1.5 h-8 text-[11px] uppercase tracking-[0.08em] font-medium border transition-colors',
                confirming
                  ? 'bg-[var(--color-success)] text-white border-[var(--color-success)]'
                  : 'bg-[var(--color-success-bg)] text-[var(--color-success)] border-[var(--color-success)] hover:bg-[var(--color-success)] hover:text-white',
              )}
            >
              {approve.isPending ? (
                <>
                  <span className="size-2.5 border-2 border-current border-r-transparent animate-spin rounded-full" />
                  Aprobando…
                </>
              ) : confirming ? (
                <>
                  <Check className="size-3" />
                  Confirmar aprobación
                </>
              ) : (
                <>
                  <Check className="size-3" />
                  Aprobar
                </>
              )}
            </button>
          </div>,
          document.body,
        )}
      </div>

      {/* Reject button */}
      <button
        type="button"
        onClick={() => setShowRejectModal(true)}
        className="inline-flex items-center justify-center size-10 rounded border transition-colors bg-[var(--color-danger-bg)] text-[var(--color-danger)] border-[var(--color-danger)] hover:bg-[var(--color-danger)] hover:text-white"
        title="Rechazar depósito"
      >
        <X className="size-3.5" />
      </button>

      {/* Review button */}
      <button
        type="button"
        onClick={handleReview}
        disabled={review.isPending || deposit.status !== 'pending'}
        className={cn(
          'inline-flex items-center justify-center size-10 rounded border transition-colors',
          deposit.status === 'pending'
            ? 'bg-[var(--color-warning-bg)] text-[var(--color-warning)] border-[var(--color-warning)] hover:bg-[var(--color-warning)] hover:text-white'
            : 'bg-[var(--color-bg-subtle)] text-[var(--color-fg-subtle)] border-[var(--color-border)] opacity-40 cursor-not-allowed',
        )}
        title="Marcar en revisión"
      >
        {review.isPending ? (
          <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
        ) : (
          <Eye className="size-3.5" />
        )}
      </button>

      {/* Receipt button */}
      {deposit.receiptUrl ? (
        <a
          href={deposit.receiptUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center size-10 rounded border transition-colors bg-[var(--color-bg-subtle)] text-[var(--color-fg-muted)] border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-fg)]"
          title="Ver comprobante"
        >
          <FileText className="size-3.5" />
        </a>
      ) : (
        <span
          className="inline-flex items-center justify-center size-7 rounded border border-[var(--color-border)] text-[var(--color-fg-subtle)] opacity-40"
          title="Sin comprobante"
        >
          <FileText className="size-3.5" />
        </span>
      )}

      {/* More menu — opens drawer detail */}
      <button
        type="button"
        onClick={onViewDetail}
        className="inline-flex items-center justify-center size-10 rounded border transition-colors bg-[var(--color-bg-subtle)] text-[var(--color-fg-muted)] border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-fg)]"
        title="Ver detalle"
      >
        <MoreHorizontal className="size-3.5" />
      </button>

      {/* Reject modal */}
      <ConfirmWithReasonModal
        open={showRejectModal}
        onOpenChange={setShowRejectModal}
        title="Rechazar depósito"
        description="El usuario será notificado y la operación queda en audit log."
        warning="El rechazo es definitivo. Si el usuario reabre el flow tendrá que crear un depósito nuevo."
        confirmLabel="Rechazar depósito"
        confirmIcon={<X className="size-3.5" />}
        reasonPlaceholder="Ej: Comprobante ilegible — reenviá foto clara."
        onConfirm={handleReject}
        isPending={reject.isPending}
      />

      {/* Match bank tx modal */}
      <MatchBankTxModal
        deposit={deposit}
        open={showMatchModal}
        onOpenChange={setShowMatchModal}
      />
    </div>
  );
}

/**
 * MatchBankTxModal — modal para matchear un depósito con una transferencia
 * bancaria sin matchear. Muestra transferencias disponibles por monto exacto
 * y permite seleccionar una. Usa Modal (Radix Portal) para renderizar
 * correctamente fuera de la tabla.
 */
function MatchBankTxModal({
  deposit,
  open,
  onOpenChange,
}: {
  deposit: DepositRow;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const matchBankTx = useMatchBankTransaction();
  const [includeAll, setIncludeAll] = useState(false);

  const { data: unmatchedRes, isLoading } = useUnmatchedForAmount(
    deposit.amountChips,
    includeAll,
    'incoming',
  );
  const candidates = unmatchedRes?.data ?? [];

  const handleMatch = async (bankTx: BankTransaction) => {
    try {
      await matchBankTx.mutateAsync({
        bankTxId: bankTx.id,
        depositId: deposit.id,
      });
      toast.success('Transferencia matcheada', {
        description: `$${bankTx.amount} de ${bankTx.senderName ?? 'desconocido'}`,
      });
      onOpenChange(false);
    } catch (err) {
      toast.error('No se pudo matchear', {
        description: isApiError(err) ? err.message : 'Error de conexión.',
      });
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Matchear transferencia"
      description={`Buscando transferencias entrantes de $${deposit.amountChips} ${deposit.currencyFiat}`}
      size="md"
      footer={
        <Button
          variant="secondary"
          size="md"
          onClick={() => onOpenChange(false)}
        >
          Cerrar
        </Button>
      }
    >
      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full bg-[var(--color-bg-subtle)]" />
          ))}
        </div>
      ) : candidates.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <div className="size-10 rounded-full bg-[var(--color-bg-subtle)] flex items-center justify-center">
            <ImageOff className="size-5 text-[var(--color-fg-subtle)]" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[13px] text-[var(--color-fg)]">
              Sin transferencias para ${deposit.amountChips}
            </span>
            <span className="text-[11px] text-[var(--color-fg-muted)]">
              No hay transferencias entrantes sin matchear con este monto exacto.
            </span>
          </div>
          <label className="flex items-center gap-2 text-[11px] text-[var(--color-fg-muted)] cursor-pointer">
            <input
              type="checkbox"
              checked={includeAll}
              onChange={(e) => setIncludeAll(e.target.checked)}
              className="accent-[var(--color-accent)]"
            />
            Mostrar todas las sin matchear
          </label>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-fg-muted)] font-medium">
              Transferencias disponibles ({candidates.length})
            </span>
            <label className="flex items-center gap-1.5 text-[10px] text-[var(--color-fg-muted)] cursor-pointer">
              <input
                type="checkbox"
                checked={includeAll}
                onChange={(e) => setIncludeAll(e.target.checked)}
                className="accent-[var(--color-accent)] size-3"
              />
              Todas
            </label>
          </div>
          {candidates.map((bt) => (
            <button
              key={bt.id}
              type="button"
              onClick={() => handleMatch(bt)}
              disabled={matchBankTx.isPending}
              className="flex items-center justify-between w-full px-3 py-2.5 bg-[var(--color-bg-subtle)] border border-[var(--color-border)] hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)] transition-colors text-left disabled:opacity-50"
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px] text-[var(--color-fg)] font-medium">
                  ${bt.amount} {bt.currency ?? 'ARS'}
                </span>
                <span className="text-[11px] text-[var(--color-fg-muted)]">
                  {bt.senderName ?? 'Sin nombre'} · Cuenta {bt.bankAccount}
                </span>
                <span className="text-[10px] text-[var(--color-fg-subtle)]">
                  Recibido {formatDateTime(bt.receivedAt)} · #{bt.id.slice(0, 8)}
                </span>
              </div>
              <Link2 className="size-4 text-[var(--color-accent-text)] shrink-0" />
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

/**
 * Sprint 51.7.1: ícono para abrir el comprobante directo desde la tabla
 * sin abrir el drawer. Útil para el operador que quiere chequear el
 * comprobante de un row específico sin perder el contexto del listado.
 *
 * - Si hay URL: ícono clip que abre en nueva pestaña + tooltip con hint
 *   sobre el tipo de archivo (imagen/pdf por extensión).
 * - Si no hay (deposit legacy o creado vacío): ícono atenuado tachado.
 *
 * `stopPropagation` para no triggerar el row click (drawer).
 */
function ReceiptQuickPeek({
  url,
  storageKey,
}: {
  url: string | null;
  storageKey: string | null;
}) {
  if (!url) {
    return (
      <span
        className="inline-flex items-center justify-center text-[var(--color-fg-subtle)]"
        title="Sin comprobante adjunto"
      >
        <ImageOff className="size-3.5" />
      </span>
    );
  }
  const lower = (storageKey ?? url).toLowerCase();
  const isPdf = lower.endsWith('.pdf');
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center justify-center gap-1 size-10 text-[var(--color-fg-muted)] hover:text-[var(--color-accent-text)] hover:bg-[var(--color-bg-subtle)] transition-colors"
      title={isPdf ? 'Abrir comprobante (PDF)' : 'Abrir comprobante (imagen)'}
    >
      <Paperclip className="size-3.5" />
      <ExternalLink className="size-2.5 -ml-0.5" />
    </a>
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
