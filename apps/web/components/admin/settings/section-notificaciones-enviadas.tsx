/**
 * Configuración · Notificaciones enviadas — vista simple de los avisos que el
 * casino le mandó a los jugadores (y a los admins).
 *
 * En criollo: tres números (Entregadas / Pendientes / Fallidas), pestañas
 * (Todas / Fallidas / Pendientes), una tabla legible con el nombre humano del
 * aviso y un botón "Reintentar" en las fallidas. Los filtros técnicos (por
 * tipo, usuario, fecha, canal) quedan plegados en "Filtros avanzados".
 *
 * Reusa `useNotificationsAdmin` + `useNotificationsStats` + `useRetryNotification`
 * y el catálogo criollo `notification-kinds-meta`. Backend sin cambios.
 */

'use client';

import {
  BellRing,
  Calendar,
  ChevronRight,
  RefreshCw,
  RotateCw,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CollapsibleCard } from '@/components/admin/collapsible-card';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CsvExportButton } from '@/components/ui/csv-export-button';
import { Drawer } from '@/components/ui/drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { TabStrip } from '@/components/ui/tab-strip';
import { isApiError } from '@/lib/api-client';
import {
  useNotificationsAdmin,
  useNotificationsStats,
  useRetryNotification,
  type NotificationChannel,
  type NotificationRow,
  type NotificationStatus,
} from '@/lib/hooks/use-notifications-admin';
import { arDatetimeLocalToIso } from '@/lib/format-date';
import {
  CATEGORY_ORDER,
  getKindMeta,
  NOTIFICATION_KINDS,
} from '@/lib/notification-kinds-meta';
import { cn } from '@/lib/cn';

const PAGE_SIZE = 50;

const STATUS_VARIANT: Record<NotificationStatus, BadgeVariant> = {
  pending: 'warning',
  sent: 'success',
  failed: 'danger',
  read: 'success',
};

const STATUS_LABEL: Record<NotificationStatus, string> = {
  pending: 'Pendiente',
  sent: 'Entregada',
  failed: 'Fallida',
  read: 'Leída',
};

const CHANNEL_LABEL: Record<NotificationChannel, string> = {
  in_app: 'En la app',
  email: 'Email',
  sms: 'SMS',
  web_push: 'Push web',
};

interface FilterTab {
  id: string;
  label: string;
  statuses?: NotificationStatus[];
}

const FILTER_TABS: FilterTab[] = [
  { id: 'all', label: 'Todas' },
  { id: 'failed', label: 'Fallidas', statuses: ['failed'] },
  { id: 'pending', label: 'Pendientes', statuses: ['pending'] },
];

export function SectionNotificacionesEnviadas() {
  const [tabId, setTabId] = useState<string>('all');
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [kind, setKind] = useState('');
  const [userId, setUserId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(0);
  const [openDetail, setOpenDetail] = useState<NotificationRow | null>(null);

  const stats = useNotificationsStats(30);
  const retry = useRetryNotification();

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
      fromDate: arDatetimeLocalToIso(fromDate),
      toDate: arDatetimeLocalToIso(toDate),
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

  const handleRetry = async (id: string) => {
    try {
      await retry.mutateAsync(id);
      toast.success('Aviso reenviado', {
        description: 'Se vuelve a intentar en el próximo envío.',
      });
    } catch (err) {
      toast.error('No se pudo reenviar', { description: mapRetryError(err) });
    }
  };

  // Números de las tarjetas (ventana de 30 días).
  const s = stats.data;
  const delivered = s ? (s.byStatus.sent ?? 0) + (s.byStatus.read ?? 0) : 0;
  const pending = s?.byStatus.pending ?? 0;
  const failed = s?.byStatus.failed ?? 0;

  return (
    <>
      <div className="flex flex-col gap-6">
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-[15px] font-semibold text-[var(--color-fg)] flex items-center gap-2">
              <BellRing className="size-4 text-[var(--color-accent-text)]" />
              Avisos enviados
            </h2>
            <p className="text-[12px] text-[var(--color-fg-muted)] max-w-2xl leading-snug">
              Acá ves todos los avisos que el casino mandó (dentro de la app,
              por email o push). Mirá cuáles llegaron, cuáles fallaron, y
              reenviá los que fallaron.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void refetch();
              void stats.refetch();
            }}
            disabled={isFetching}
            className="shrink-0"
          >
            <RefreshCw className={cn('size-3.5', isFetching && 'animate-spin')} />
            Refrescar
          </Button>
        </header>

        {/* 3 tiles — últimos 30 días */}
        {stats.isLoading && !s ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full bg-[var(--color-bg-subtle)]" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StatTile
              label="Entregadas"
              value={delivered.toLocaleString('es-AR')}
              hint="Llegaron bien"
              accent={delivered > 0 ? 'success' : 'neutral'}
            />
            <StatTile
              label="Pendientes"
              value={pending.toLocaleString('es-AR')}
              hint={pending > 0 ? 'Esperando ser enviadas' : 'Nada en cola'}
              accent={pending > 0 ? 'accent' : 'neutral'}
            />
            <StatTile
              label="Fallidas"
              value={failed.toLocaleString('es-AR')}
              hint={failed > 0 ? 'Se pueden reenviar' : 'Sin fallas'}
              accent={failed > 0 ? 'danger' : 'neutral'}
            />
          </div>
        )}

        {/* Tabs */}
        <TabStrip
          className="sm:self-start"
          rowClassName="rounded-none"
          label="Filtrar notificaciones enviadas"
        >
          {FILTER_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTabId(t.id);
                setPage(0);
              }}
              className={cn(
                'shrink-0 whitespace-nowrap px-4 h-11 lg:h-8 text-[11px] uppercase tracking-[0.08em] font-medium',
                'transition-colors duration-150',
                tabId === t.id
                  ? 'bg-[var(--color-bg)] text-[var(--color-fg)] border-b-2 border-b-[var(--color-accent)]'
                  : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]',
              )}
            >
              {t.label}
            </button>
          ))}
        </TabStrip>

        {/* Filtros avanzados (plegado) */}
        <CollapsibleCard
          title="Filtros avanzados"
          icon={<SlidersHorizontal className="size-4" />}
          defaultOpen={false}
          right={
            hasFilters ? (
              <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-accent-text)]">
                activos
              </span>
            ) : undefined
          }
          bodyClassName="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
        >
          <FormField id="n-kind" label="Tipo de aviso">
            <Select
              id="n-kind"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setPage(0);
              }}
            >
              <option value="">Todos</option>
              {CATEGORY_ORDER.map((cat) => {
                const items = NOTIFICATION_KINDS.filter((k) => k.category === cat);
                if (items.length === 0) return null;
                return (
                  <optgroup key={cat} label={cat}>
                    {items.map((k) => (
                      <option key={k.code} value={k.code}>
                        {k.label}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </Select>
          </FormField>

          <FormField id="n-user" label="ID de usuario" hint="UUID exacto">
            <Input
              id="n-user"
              type="text"
              value={userId}
              onChange={(e) => {
                setUserId(e.target.value);
                setPage(0);
              }}
              placeholder="0193…"
              className="font-mono"
            />
          </FormField>

          <FormField id="n-from" label="Desde">
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

          <FormField id="n-to" label="Hasta">
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

          <div className="md:col-span-2 lg:col-span-4 flex items-center justify-between gap-3 flex-wrap pt-2 border-t border-[var(--color-border)]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] font-medium">
                Canal
              </span>
              {(['in_app', 'email', 'sms', 'web_push'] as NotificationChannel[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleChannel(c)}
                  className={cn(
                    'px-2.5 h-7 text-[11px] font-medium border transition-colors',
                    channels.includes(c)
                      ? 'bg-[var(--color-bg-subtle)] text-[var(--color-fg)] border-[var(--color-border-strong)]'
                      : 'bg-[var(--color-bg-subtle)] text-[var(--color-fg-muted)] border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-fg)]',
                  )}
                >
                  {CHANNEL_LABEL[c]}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {hasFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  <X className="size-3.5" />
                  Limpiar
                </Button>
              )}
              <CsvExportButton
                path="/tenant/notifications/export"
                params={{
                  statuses: tab.statuses?.join(','),
                  channels: channels.length > 0 ? channels.join(',') : undefined,
                  kind: kind.trim() || undefined,
                  userId: userId.trim() || undefined,
                  fromDate: arDatetimeLocalToIso(fromDate),
                  toDate: arDatetimeLocalToIso(toDate),
                }}
                filenameHint="notifications"
                permission="notifications.export"
                entityLabel="notifications"
              />
            </div>
          </div>
        </CollapsibleCard>

        {/* Tabla */}
        <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto">
          {isLoading ? (
            <LoadingTable />
          ) : isError ? (
            <div className="p-6">
              <EmptyState
                hint="notifications"
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
                hint="notifications"
                label={
                  hasFilters || tabId !== 'all'
                    ? 'No hay avisos con estos filtros'
                    : 'Todavía no se enviaron avisos'
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
                  <TH>A quién</TH>
                  <TH>Aviso</TH>
                  <TH>Canal</TH>
                  <TH>Estado</TH>
                  <TH align="right" className="w-8"></TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((n, i) => {
                  const meta = getKindMeta(n.kind);
                  return (
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
                        <span className="text-[12px] text-[var(--color-fg)] truncate max-w-[180px] block">
                          {n.userDisplayName ??
                            (n.userUsername ? `@${n.userUsername}` : '—')}
                        </span>
                      </TD>
                      <TD>
                        <span className="text-[12px] text-[var(--color-fg)]">
                          {meta.label}
                        </span>
                      </TD>
                      <TD>
                        <span className="text-[12px] text-[var(--color-fg-muted)]">
                          {CHANNEL_LABEL[n.channel]}
                        </span>
                      </TD>
                      <TD>
                        <Badge variant={STATUS_VARIANT[n.status]} dot>
                          {STATUS_LABEL[n.status]}
                        </Badge>
                      </TD>
                      <TD align="right">
                        {n.status === 'failed' ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleRetry(n.id);
                            }}
                            disabled={retry.isPending}
                          >
                            <RotateCw className="size-3.5" />
                            Reenviar
                          </Button>
                        ) : (
                          <ChevronRight className="size-3.5 text-[var(--color-fg-subtle)] inline" />
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

      <NotificationDetailDrawer
        notification={openDetail}
        open={!!openDetail}
        onOpenChange={(o) => !o && setOpenDetail(null)}
        onRetry={handleRetry}
        retrying={retry.isPending}
      />
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Detail drawer — amigable
// ──────────────────────────────────────────────────────────────────────

function NotificationDetailDrawer({
  notification,
  open,
  onOpenChange,
  onRetry,
  retrying,
}: {
  notification: NotificationRow | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onRetry: (id: string) => Promise<void>;
  retrying: boolean;
}) {
  const canRetry = notification?.status === 'failed';
  const meta = notification ? getKindMeta(notification.kind) : null;

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={meta?.label ?? 'Aviso'}
      subtitle={
        notification
          ? `${CHANNEL_LABEL[notification.channel]} · ${STATUS_LABEL[notification.status]}`
          : undefined
      }
      footer={
        canRetry && notification ? (
          <>
            <Button
              variant="secondary"
              size="md"
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={retrying}
            >
              Cerrar
            </Button>
            <Button
              variant="primary"
              size="md"
              type="button"
              onClick={() => {
                void onRetry(notification.id).then(() => onOpenChange(false));
              }}
              disabled={retrying}
            >
              {retrying ? (
                <>
                  <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                  Reenviando…
                </>
              ) : (
                <>
                  <RotateCw className="size-3.5" />
                  Reenviar
                </>
              )}
            </Button>
          </>
        ) : undefined
      }
    >
      {notification && (
        <div className="flex flex-col gap-5">
          {meta && (
            <p className="text-[13px] text-[var(--color-fg-muted)]">
              {meta.whenSent}
            </p>
          )}

          <Field label="A quién le llegó">
            <span className="text-[13px] text-[var(--color-fg)]">
              {notification.userDisplayName ??
                (notification.userUsername
                  ? `@${notification.userUsername}`
                  : '—')}
            </span>
          </Field>

          {/* El mensaje tal cual se envió */}
          <Field label="Mensaje enviado">
            <div className="bg-[var(--color-bg-subtle)] border border-[var(--color-border)] p-3 flex flex-col gap-1">
              <span className="text-[13px] font-semibold text-[var(--color-fg)]">
                {notification.subject}
              </span>
              <span className="text-[12px] text-[var(--color-fg-muted)] whitespace-pre-wrap break-words">
                {notification.body}
              </span>
            </div>
          </Field>

          {notification.error && (
            <Field label="Qué salió mal">
              <div className="bg-[var(--color-accent-subtle)] border border-[var(--color-accent-border)] p-3">
                <p className="text-[12px] text-[var(--color-accent-text)] whitespace-pre-wrap break-words">
                  {notification.error}
                </p>
              </div>
            </Field>
          )}

          <Field label="Cuándo">
            <div className="flex flex-col gap-1 text-[12px] text-[var(--color-fg-muted)]">
              <span>Creado: {formatShort(notification.createdAt)}</span>
              {notification.sentAt && (
                <span>Enviado: {formatShort(notification.sentAt)}</span>
              )}
              {notification.readAt && (
                <span>Leído: {formatShort(notification.readAt)}</span>
              )}
            </div>
          </Field>
        </div>
      )}
    </Drawer>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────

function StatTile({
  label,
  value,
  hint,
  accent = 'neutral',
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: 'neutral' | 'success' | 'danger' | 'accent';
}) {
  return (
    <div
      className={cn(
        'px-4 py-3 bg-[var(--color-bg-elevated)] border border-[var(--color-border)]',
        accent === 'success' && 'border-l-2 border-l-[var(--color-success)]',
        accent === 'danger' && 'border-l-2 border-l-[var(--color-danger)]',
        accent === 'accent' && 'border-l-2 border-l-[var(--color-accent)]',
      )}
    >
      <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)]">
        {label}
      </div>
      <div className="font-display text-3xl tabular-nums tracking-tight text-[var(--color-fg)] mt-1 truncate">
        {value}
      </div>
      {hint && (
        <div className="text-[11px] text-[var(--color-fg-subtle)] mt-0.5 truncate">
          {hint}
        </div>
      )}
    </div>
  );
}

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
          className="px-3 h-11 lg:h-7 text-[11px] uppercase tracking-[0.08em] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Anterior
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!hasMore}
          className="px-3 h-11 lg:h-7 text-[11px] uppercase tracking-[0.08em] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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

function formatShort(iso: string): string {
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

function mapRetryError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.status === 403) return 'No tenés permiso para reenviar.';
  if (err.status === 404) {
    if (err.code === 'NOTIFICATION_NOT_RETRIABLE') {
      return 'Solo se pueden reenviar los avisos fallidos.';
    }
    return 'El aviso ya no existe.';
  }
  return err.message || 'Error inesperado.';
}
