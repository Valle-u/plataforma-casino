/**
 * /bonuses â€” panel de bonos del tenant.
 *
 * ComposiciÃ³n:
 *   - Header con tÃ­tulo + botÃ³n "Otorgar bono" (abre GrantBonusModal).
 *   - Tabs filter: Activos / Liberados / Cancelados / Expirados / Todos.
 *   - Tabla densa: usuario, definition (name + type), monto otorgado /
 *     remaining, status badge, fecha.
 *   - Click row â†’ ConfirmWithReasonModal de cancel directo (cuando el
 *     bono estÃ¡ active/pending) o nada (cuando ya estÃ¡ resuelto).
 *
 * Para sprints futuros: drawer de detalle con timeline del bono +
 * force-clear (con 2FA).
 */

'use client';

import { Ban, Gift, Plus, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { GrantBonusModal } from '@/components/admin/grant-bonus-modal';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmWithReasonModal } from '@/components/ui/confirm-with-reason-modal';
import { CsvExportButton } from '@/components/ui/csv-export-button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { isApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import {
  useBonuses,
  useCancelBonus,
  type BonusRow,
  type BonusStatus,
} from '@/lib/hooks/use-bonuses';
import { cn } from '@/lib/cn';

const PAGE_SIZE = 25;

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
  force_cleared: 'force-clear',
};

interface FilterTab {
  id: string;
  label: string;
  statuses?: BonusStatus[];
}

const FILTER_TABS: FilterTab[] = [
  { id: 'active', label: 'Activos', statuses: ['active', 'pending'] },
  { id: 'cleared', label: 'Liberados', statuses: ['cleared', 'force_cleared'] },
  { id: 'cancelled', label: 'Cancelados', statuses: ['cancelled'] },
  { id: 'expired', label: 'Expirados', statuses: ['expired'] },
  { id: 'all', label: 'Todos' },
];

export default function BonusesPage() {
  const { user: actor } = useAuth();
  const [tabId, setTabId] = useState<string>('active');
  const [page, setPage] = useState(0);
  const [grantOpen, setGrantOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<BonusRow | null>(null);

  const tab = useMemo(
    () => FILTER_TABS.find((t) => t.id === tabId) ?? FILTER_TABS[0]!,
    [tabId],
  );

  const { data, isLoading, isError, refetch, isFetching } = useBonuses({
    statuses: tab.statuses,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const cancelMutation = useCancelBonus(cancelTarget?.id ?? null);

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;

  const handleCancel = async (reason: string) => {
    if (!cancelTarget) return;
    try {
      await cancelMutation.mutateAsync({ reason });
      toast.success('Bono cancelado', {
        description: `${cancelTarget.grantedAmount} CHIPS revertidos al funder.`,
      });
      setCancelTarget(null);
    } catch (err) {
      toast.error('No se pudo cancelar el bono', {
        description: mapServerError(err),
      });
    }
  };

  return (
    <>
      <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[1600px] mx-auto">
        {/* Header */}
        <header className="flex items-end justify-between gap-6 pb-2">
          <div className="flex flex-col gap-2">
            <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
              <Gift className="size-3" />
              Engagement Â· Bonos
            </span>
            <h1 className="font-display text-[2.5rem] leading-none tracking-tight">
              Bonos del tenant
            </h1>
            <p className="text-sm text-[var(--color-fg-muted)] mt-1">
              {data ? `${rows.length} de ${total} en esta vista` : 'Cargandoâ€¦'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <CsvExportButton
              path="/tenant/bonuses/export"
              params={{
                statuses: tab.statuses?.join(','),
              }}
              filenameHint="bonuses"
              entityLabel="bonos"
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
            <Button variant="primary" size="md" onClick={() => setGrantOpen(true)}>
              <Plus className="size-3.5" />
              Otorgar bono
            </Button>
          </div>
        </header>

        {/* Tabs filter */}
        <div className="flex items-center gap-px bg-[var(--color-border)] border border-[var(--color-border)] self-start flex-wrap">
          {FILTER_TABS.map((t) => (
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

        {/* Table */}
        <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
          {isLoading ? (
            <LoadingTable />
          ) : isError ? (
            <div className="p-6">
              <EmptyState
                hint="bonuses"
                label="No se pudo cargar la lista."
                action={
                  <Button variant="secondary" size="sm" onClick={() => refetch()}>
                    Reintentar
                  </Button>
                }
              />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-6">
              <EmptyState
                hint="bonuses"
                stream={`tenant Â· status=${tab.statuses?.join(',') ?? '*'}`}
                label={
                  tabId === 'active'
                    ? 'No hay bonos activos'
                    : 'Sin bonos en este filtro'
                }
                action={
                  tabId === 'active' ? (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => setGrantOpen(true)}
                    >
                      <Plus className="size-3.5" />
                      Otorgar primer bono
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Usuario</TH>
                  <TH>Bono</TH>
                  <TH align="right">Otorgado</TH>
                  <TH align="right">Remaining</TH>
                  <TH>Estado</TH>
                  <TH align="right">Fecha</TH>
                  <TH align="right" className="w-12"></TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((b, i) => {
                  const isCancellable =
                    b.status === 'active' || b.status === 'pending';
                  return (
                    <TR
                      key={b.id}
                      className="animate-fade-up-staggered"
                      style={{ animationDelay: `${Math.min(i * 25, 500)}ms` }}
                    >
                      <TD>
                        <div className="flex flex-col">
                          <span className="text-[13px] text-[var(--color-fg)]">
                            {b.userDisplayName ?? b.userUsername ?? 'â€”'}
                          </span>
                          <span className="text-[10px] text-[var(--color-fg-subtle)] font-mono">
                            {b.userUsername
                              ? `@${b.userUsername}`
                              : b.userId.slice(0, 13) + 'â€¦'}
                          </span>
                        </div>
                      </TD>
                      <TD>
                        <div className="flex flex-col">
                          <span className="text-[13px] text-[var(--color-fg)]">
                            {b.definitionName ?? b.definitionCode ?? 'â€”'}
                          </span>
                          <span className="text-[10px] text-[var(--color-fg-subtle)] font-mono uppercase">
                            {b.definitionType ?? ''}
                          </span>
                        </div>
                      </TD>
                      <TD numeric>{b.grantedAmount}</TD>
                      <TD numeric>
                        <span
                          className={cn(
                            Number(b.remainingAmount) > 0
                              ? 'text-[var(--color-fg)]'
                              : 'text-[var(--color-fg-subtle)]',
                          )}
                        >
                          {b.remainingAmount}
                        </span>
                      </TD>
                      <TD>
                        <Badge variant={STATUS_VARIANT[b.status]} dot>
                          {STATUS_LABEL[b.status]}
                        </Badge>
                      </TD>
                      <TD numeric className="text-[var(--color-fg-subtle)]">
                        {formatDate(b.grantedAt)}
                      </TD>
                      <TD>
                        {isCancellable && (
                          <button
                            type="button"
                            onClick={() => setCancelTarget(b)}
                            className="size-7 flex items-center justify-center text-[var(--color-fg-subtle)] hover:text-[var(--color-accent-text)] hover:bg-[var(--color-bg-subtle)] transition-colors"
                            aria-label="Cancelar bono"
                            title="Cancelar bono"
                          >
                            <Ban className="size-3.5" />
                          </button>
                        )}
                      </TD>
                    </TR>
                  );
                })}
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

      {actor && (
        <GrantBonusModal
          open={grantOpen}
          onOpenChange={setGrantOpen}
          actorUserId={actor.id}
        />
      )}

      <ConfirmWithReasonModal
        open={!!cancelTarget}
        onOpenChange={(o) => !o && setCancelTarget(null)}
        title="Cancelar bono"
        description="El remaining vuelve al funder y el usuario es notificado."
        warning="AcciÃ³n definitiva. El usuario no podrÃ¡ usar lo que quedaba del bono."
        confirmLabel="Cancelar bono"
        confirmIcon={<Ban className="size-3.5" />}
        reasonPlaceholder="Ej: Otorgado por error â€” usuario lo solicitÃ³."
        onConfirm={handleCancel}
        isPending={cancelMutation.isPending}
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
        {total === 0 ? 'â€”' : `${start}â€“${end} de ${total}`}
      </span>
      <div className="flex items-center gap-px bg-[var(--color-border)]">
        <button
          type="button"
          onClick={onPrev}
          disabled={page === 0}
          className="px-3 h-7 text-[11px] uppercase tracking-[0.08em] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          â† Prev
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!hasMore}
          className="px-3 h-7 text-[11px] uppercase tracking-[0.08em] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Next â†’
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

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('es-AR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function mapServerError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexiÃ³n.';
  if (err.status === 409) return err.message || 'Conflicto al procesar.';
  if (err.status === 403) return 'No tenÃ©s permiso para esta operaciÃ³n.';
  if (err.status === 404) return 'El bono ya no existe.';
  if (err.status === 400) return err.message || 'Datos invÃ¡lidos.';
  return err.message || 'Error inesperado.';
}
