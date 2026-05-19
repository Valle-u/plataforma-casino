/**
 * /notifications â€” admin queue de notifications outbound.
 *
 * ComposiciÃ³n:
 *   - Header con tÃ­tulo + counter de entries.
 *   - Tabs por status (Pendientes / Enviadas / Fallidas / LeÃ­das / Todas).
 *   - Toolbar de filtros: channel (in_app/email/sms), kind (texto exacto),
 *     userId (UUID exacto), datetime-local from/to.
 *   - Tabla densa: fecha, user, kind, channel, status, subject (preview).
 *   - Click row â†’ Drawer con detalle completo (subject, body, payload JSON,
 *     error si failed, timestamps).
 *
 * No expone acciones admin (retry/cancel) en MVP â€” el dispatcher cron
 * reintenta automÃ¡ticamente. Para retry manual sumar `POST /:id/retry`
 * en backend (sprint futuro si emerge necesidad).
 */

'use client';

import {
  AlertTriangle,
  BellRing,
  Calendar,
  ChevronRight,
  Filter,
  RefreshCw,
  RotateCw,
  Search,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CsvExportButton } from '@/components/ui/csv-export-button';
import { Drawer } from '@/components/ui/drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { isApiError } from '@/lib/api-client';
import {
  useNotificationsAdmin,
  useRetryNotification,
  type NotificationChannel,
  type NotificationRow,
  type NotificationStatus,
} from '@/lib/hooks/use-notifications-admin';
import { cn } from '@/lib/cn';

const PAGE_SIZE = 50;

const STATUS_VARIANT: Record<NotificationStatus, BadgeVariant> = {
  pending: 'warning',
  sent: 'success',
  failed: 'danger',
  read: 'neutral',
};

const STATUS_LABEL: Record<NotificationStatus, string> = {
  pending: 'pendiente',
  sent: 'enviada',
  failed: 'fallida',
  read: 'leÃ­da',
};

const CHANNEL_VARIANT: Record<NotificationChannel, BadgeVariant> = {
  in_app: 'info',
  email: 'neutral',
  sms: 'neutral',
};

interface FilterTab {
  id: string;
  label: string;
  statuses?: NotificationStatus[];
}

const FILTER_TABS: FilterTab[] = [
  { id: 'pending', label: 'Pendientes', statuses: ['pending'] },
  { id: 'sent', label: 'Enviadas', statuses: ['sent'] },
  { id: 'failed', label: 'Fallidas', statuses: ['failed'] },
  { id: 'read', label: 'LeÃ­das', statuses: ['read'] },
  { id: 'all', label: 'Todas' },
];

export default function NotificationsPage() {
  const [tabId, setTabId] = useState<string>('pending');
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [kind, setKind] = useState('');
  const [userId, setUserId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(0);
  const [openDetail, setOpenDetail] = useState<NotificationRow | null>(null);

  const tab = useMemo(
    () => FILTER_TABS.find((t) => t.id === tabId) ?? FILTER_TABS[0]!,
    [tabId],
  );

  const filters = useMemo(
    () => ({
      statuses: tab.statuses,
      channels: channels.length > 0 ? channels : undefined,
      kind: kind.trim() || undefined,
      userId: userId.trim() || undefined,
      fromDate: fromDate ? new Date(fromDate).toISOString() : undefined,
      toDate: toDate ? new Date(toDate).toISOString() : undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [tab.statuses, channels, kind, userId, fromDate, toDate, page],
  );

  const { data, isLoading, isError, refetch, isFetching } =
    useNotificationsAdmin(filters);
  const rows = data?.data ?? [];
  const total = data?.total ?? 0;

  const hasFilters =
    channels.length > 0 || !!kind || !!userId || !!fromDate || !!toDate;

  const clearFilters = () => {
    setChannels([]);
    setKind('');
    setUserId('');
    setFromDate('');
    setToDate('');
    setPage(0);
  };

  const toggleChannel = (c: NotificationChannel) => {
    setChannels((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
    );
    setPage(0);
  };

  return (
    <>
      <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[1600px] mx-auto">
        {/* Header */}
        <header className="flex items-end justify-between gap-6 pb-2">
          <div className="flex flex-col gap-2">
            <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
              <BellRing className="size-3" />
              Plataforma Â· Notifications
            </span>
            <h1 className="font-display text-[2.5rem] leading-none tracking-tight">
              Queue de notifications
            </h1>
            <p className="text-sm text-[var(--color-fg-muted)] mt-1">
              {data
                ? `${rows.length} de ${total} entries en esta vista`
                : 'Cargandoâ€¦'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <CsvExportButton
              path="/tenant/notifications/export"
              params={{
                statuses: tab.statuses?.join(','),
                channels: channels.length > 0 ? channels.join(',') : undefined,
                kind: kind.trim() || undefined,
                userId: userId.trim() || undefined,
                fromDate: fromDate
                  ? new Date(fromDate).toISOString()
                  : undefined,
                toDate: toDate ? new Date(toDate).toISOString() : undefined,
              }}
              filenameHint="notifications"
              entityLabel="notifications"
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

        {/* Status tabs */}
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

        {/* Filter bar */}
        <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <FormField id="n-kind" label="Kind" hint="Exacto. Ej: deposit_approved">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[var(--color-fg-subtle)] pointer-events-none" />
              <Input
                id="n-kind"
                type="text"
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value);
                  setPage(0);
                }}
                placeholder="welcome_bonus_blocked"
                className="pl-9 font-mono"
              />
            </div>
          </FormField>

          <FormField id="n-user" label="User ID" hint="UUID exacto">
            <Input
              id="n-user"
              type="text"
              value={userId}
              onChange={(e) => {
                setUserId(e.target.value);
                setPage(0);
              }}
              placeholder="0193â€¦"
              className="font-mono"
            />
          </FormField>

          <FormField id="n-from" label="Desde" hint="Local time">
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[var(--color-fg-subtle)] pointer-events-none" />
              <Input
                id="n-from"
                type="datetime-local"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  setPage(0);
                }}
                className="pl-9"
              />
            </div>
          </FormField>

          <FormField id="n-to" label="Hasta" hint="Local time">
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[var(--color-fg-subtle)] pointer-events-none" />
              <Input
                id="n-to"
                type="datetime-local"
                value={toDate}
                onChange={(e) => {
                  setToDate(e.target.value);
                  setPage(0);
                }}
                className="pl-9"
              />
            </div>
          </FormField>

          {/* Channel chips */}
          <div className="md:col-span-2 lg:col-span-4 flex items-center justify-between gap-3 flex-wrap pt-2 border-t border-[var(--color-border)]">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] font-medium">
                Channel
              </span>
              {(['in_app', 'email', 'sms'] as NotificationChannel[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleChannel(c)}
                  className={cn(
                    'px-2.5 h-7 text-[11px] uppercase tracking-[0.08em] font-medium border transition-colors',
                    channels.includes(c)
                      ? 'bg-[var(--color-accent)] text-[var(--color-accent-fg)] border-[var(--color-accent)]'
                      : 'bg-[var(--color-bg-subtle)] text-[var(--color-fg-muted)] border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-fg)]',
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              {hasFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  <X className="size-3.5" />
                  Limpiar
                </Button>
              )}
              <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] flex items-center gap-1.5">
                <Filter className="size-3" />
                {hasFilters ? 'filtros activos' : 'sin filtros'}
              </span>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
          {isLoading ? (
            <LoadingTable />
          ) : isError ? (
            <div className="p-6">
              <EmptyState
                hint="notifications"
                label="No se pudo cargar la queue."
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
                hint="notifications"
                stream={`tenant Â· status=${tab.statuses?.join(',') ?? '*'}`}
                label={
                  hasFilters || tabId !== 'all'
                    ? 'Sin notifications con estos filtros'
                    : 'El queue estÃ¡ vacÃ­o'
                }
                action={
                  hasFilters ? (
                    <Button variant="secondary" size="sm" onClick={clearFilters}>
                      Limpiar filtros
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Fecha</TH>
                  <TH>Usuario</TH>
                  <TH>Kind</TH>
                  <TH>Channel</TH>
                  <TH>Estado</TH>
                  <TH>Subject</TH>
                  <TH align="right" className="w-8"></TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((n, i) => (
                  <TR
                    key={n.id}
                    onClick={() => setOpenDetail(n)}
                    className="animate-fade-up-staggered cursor-pointer"
                    style={{ animationDelay: `${Math.min(i * 20, 400)}ms` }}
                  >
                    <TD numeric className="text-[var(--color-fg-subtle)]">
                      {formatShort(n.createdAt)}
                    </TD>
                    <TD>
                      <div className="flex flex-col">
                        <span className="text-[12px] text-[var(--color-fg)] truncate max-w-[180px]">
                          {n.userDisplayName ?? n.userUsername ?? 'â€”'}
                        </span>
                        <span className="text-[10px] text-[var(--color-fg-subtle)] font-mono truncate">
                          {n.userUsername
                            ? `@${n.userUsername}`
                            : n.userId.slice(0, 13) + 'â€¦'}
                        </span>
                      </div>
                    </TD>
                    <TD>
                      <span className="text-[11px] font-mono text-[var(--color-fg-muted)]">
                        {n.kind}
                      </span>
                    </TD>
                    <TD>
                      <Badge variant={CHANNEL_VARIANT[n.channel]}>
                        {n.channel}
                      </Badge>
                    </TD>
                    <TD>
                      <div className="flex items-center gap-2">
                        <Badge variant={STATUS_VARIANT[n.status]} dot>
                          {STATUS_LABEL[n.status]}
                        </Badge>
                        {n.status === 'failed' && (
                          <AlertTriangle className="size-3 text-[var(--color-accent-text)]" />
                        )}
                      </div>
                    </TD>
                    <TD>
                      <span className="text-[12px] text-[var(--color-fg)] line-clamp-1 max-w-[280px]">
                        {n.subject}
                      </span>
                    </TD>
                    <TD>
                      <ChevronRight className="size-3.5 text-[var(--color-fg-subtle)]" />
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

      <NotificationDetailDrawer
        notification={openDetail}
        open={!!openDetail}
        onOpenChange={(o) => !o && setOpenDetail(null)}
      />
    </>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Detail drawer
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function NotificationDetailDrawer({
  notification,
  open,
  onOpenChange,
}: {
  notification: NotificationRow | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const retry = useRetryNotification();
  const canRetry = notification?.status === 'failed';

  const handleRetry = async () => {
    if (!notification) return;
    try {
      await retry.mutateAsync(notification.id);
      toast.success('Notification re-encolada', {
        description: 'El dispatcher la procesa en su prÃ³ximo run.',
      });
      onOpenChange(false);
    } catch (err) {
      toast.error('No se pudo re-encolar', { description: mapRetryError(err) });
    }
  };

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={notification?.subject ?? 'Notification'}
      subtitle={notification ? `${notification.kind} Â· ${notification.channel}` : undefined}
      footer={
        canRetry ? (
          <>
            <Button
              variant="secondary"
              size="md"
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={retry.isPending}
            >
              Cerrar
            </Button>
            <Button
              variant="primary"
              size="md"
              type="button"
              onClick={handleRetry}
              disabled={retry.isPending}
            >
              {retry.isPending ? (
                <>
                  <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                  Encolandoâ€¦
                </>
              ) : (
                <>
                  <RotateCw className="size-3.5" />
                  Reintentar
                </>
              )}
            </Button>
          </>
        ) : undefined
      }
    >
      {notification && (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Estado">
              <Badge variant={STATUS_VARIANT[notification.status]} dot>
                {STATUS_LABEL[notification.status]}
              </Badge>
            </Field>
            <Field label="Channel">
              <Badge variant={CHANNEL_VARIANT[notification.channel]}>
                {notification.channel}
              </Badge>
            </Field>
          </div>

          <Field label="Usuario">
            <div className="flex flex-col gap-0.5">
              <span className="text-[13px] text-[var(--color-fg)]">
                {notification.userDisplayName ?? notification.userUsername ?? 'â€”'}
              </span>
              <span className="text-[10px] font-mono text-[var(--color-fg-subtle)] break-all">
                {notification.userId}
              </span>
            </div>
          </Field>

          <Field label="Subject">
            <p className="text-[13px] text-[var(--color-fg)]">
              {notification.subject}
            </p>
          </Field>

          <Field label="Body">
            <pre className="text-[12px] font-sans leading-relaxed bg-[var(--color-bg)] border border-[var(--color-border)] p-3 whitespace-pre-wrap break-words max-h-[300px] overflow-y-auto text-[var(--color-fg)]">
              {notification.body}
            </pre>
          </Field>

          {notification.error && (
            <Field label="Error">
              <pre className="text-[11px] font-mono leading-relaxed bg-[var(--color-accent-subtle)] border border-[var(--color-accent-border)] p-3 whitespace-pre-wrap break-words max-h-[160px] overflow-y-auto text-[var(--color-accent-text)]">
                {notification.error}
              </pre>
            </Field>
          )}

          <Field label="Payload">
            <JsonBox value={notification.payload} />
          </Field>

          <Field label="Timestamps">
            <div className="grid grid-cols-3 gap-2 text-[11px] font-mono text-[var(--color-fg-muted)]">
              <TimestampItem label="created" iso={notification.createdAt} />
              <TimestampItem label="sent" iso={notification.sentAt} />
              <TimestampItem label="read" iso={notification.readAt} />
            </div>
          </Field>
        </div>
      )}
    </Drawer>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Sub-components
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] font-medium">
        {label}
      </span>
      {children}
    </div>
  );
}

function TimestampItem({ label, iso }: { label: string; iso: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)]">
        {label}
      </span>
      <span
        className={cn(
          iso
            ? 'text-[var(--color-fg)]'
            : 'text-[var(--color-fg-subtle)] italic',
        )}
        title={iso ?? undefined}
      >
        {iso ? formatShort(iso) : 'â€”'}
      </span>
    </div>
  );
}

function JsonBox({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return (
      <span className="text-[12px] text-[var(--color-fg-subtle)] italic">
        null
      </span>
    );
  }
  let formatted: string;
  try {
    formatted = JSON.stringify(value, null, 2);
  } catch {
    formatted = String(value);
  }
  if (formatted === '{}') {
    return (
      <span className="text-[11px] text-[var(--color-fg-subtle)] italic">
        vacÃ­o
      </span>
    );
  }
  return (
    <pre className="text-[11px] font-mono leading-relaxed bg-[var(--color-bg)] border border-[var(--color-border)] p-3 overflow-x-auto whitespace-pre-wrap break-all max-h-[240px] overflow-y-auto text-[var(--color-fg)]">
      {formatted}
    </pre>
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

function formatShort(iso: string): string {
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

function mapRetryError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexiÃ³n.';
  if (err.status === 403) return 'No tenÃ©s permiso para reintentar.';
  if (err.status === 404) {
    if (err.code === 'NOTIFICATION_NOT_RETRIABLE') {
      return 'Solo se pueden reintentar notifications con status=failed.';
    }
    return 'La notification ya no existe.';
  }
  return err.message || 'Error inesperado.';
}
