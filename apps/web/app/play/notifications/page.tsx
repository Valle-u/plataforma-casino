/**
 * /play/notifications — inbox del jugador.
 *
 * Composición:
 *   - Header con counter total + botón "Marcar todas como leídas".
 *   - Tabs: Todas / No leídas.
 *   - Lista vertical de cards: icono por kind + subject + body + timestamp
 *     + badge "no leída" + botón inline para marcar.
 *
 * Endpoint:
 *   - GET /tenant/notifications/me?onlyUnread=
 *   - POST /tenant/notifications/me/:id/read
 *   - POST /tenant/notifications/me/read-all
 *
 * Comportamiento UX:
 *   - El badge "no leída" desaparece tras click (optimistic UI vía
 *     invalidate de la query → refetch automático).
 *   - "Marcar todas" deshabilitado si no hay no-leídas.
 *   - Sin paginación todavía — limit 50 cubre el caso típico. Si emerge
 *     necesidad real (jugador power-user con 100+ notifs), sumar Más/load-more.
 */

'use client';

import {
  Bell,
  Check,
  CheckCheck,
  CircleDollarSign,
  Coins,
  Gift,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Trophy,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useMyNotifications,
  type MyNotification,
} from '@/lib/hooks/use-my-notifications';
import { cn } from '@/lib/cn';

type Tab = 'all' | 'unread';

const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'Todas' },
  { id: 'unread', label: 'No leídas' },
];

/**
 * Heuristic por prefix del `kind` para elegir un icono. Si emerge un kind
 * nuevo sin match, cae al Bell genérico. No crítico — el subject ya
 * comunica el contexto, el icono es solo afterthought visual.
 */
function iconForKind(kind: string): LucideIcon {
  if (kind.startsWith('deposit')) return CircleDollarSign;
  if (kind.startsWith('withdrawal')) return Coins;
  if (kind.startsWith('bonus')) return Gift;
  if (kind.startsWith('promotion') || kind.startsWith('promo')) return Sparkles;
  if (kind.startsWith('league')) return Trophy;
  if (kind.startsWith('fraud')) return ShieldAlert;
  return Bell;
}

export default function PlayNotificationsPage() {
  const [tab, setTab] = useState<Tab>('all');
  const { data, isLoading, isError, refetch, isFetching } = useMyNotifications({
    limit: 50,
    onlyUnread: tab === 'unread',
  });
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const items = useMemo(() => data?.data ?? [], [data]);
  const hasUnread = useMemo(() => items.some((n) => !n.readAt), [items]);

  return (
    <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col gap-6 sm:gap-8">
      {/* Header — Sprint 51.23.1 mobile fix:
        * En mobile las dos CTAs no entran al lado del título. Apilamos
        * vertical (title arriba, acciones full-width abajo) hasta sm.
        * En sm+ vuelve al layout horizontal histórico. */}
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 sm:gap-6 pb-2">
        <div className="flex flex-col gap-1.5 sm:gap-2 min-w-0">
          <span className="text-[10px] sm:text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
            <Bell className="size-3" />
            Inbox
          </span>
          <h1 className="font-display text-2xl sm:text-[2.5rem] leading-tight sm:leading-none tracking-tight">
            Notificaciones
          </h1>
          <p className="text-[12px] sm:text-sm text-[var(--color-fg-muted)] mt-0.5 sm:mt-1">
            {data
              ? items.length === 0
                ? 'Sin notificaciones por ahora.'
                : `${items.length} notificaciones${tab === 'unread' ? ' sin leer' : ''}`
              : 'Cargando…'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="secondary"
            size="md"
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex-1 sm:flex-none justify-center"
            aria-label="Refrescar"
            title="Refrescar"
          >
            <RefreshCw
              className={cn('size-3.5', isFetching && 'animate-spin')}
            />
            <span className="hidden sm:inline">Refrescar</span>
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={async () => {
              try {
                const res = await markAll.mutateAsync();
                if (res.updated > 0) {
                  toast.success(
                    `${res.updated} ${res.updated === 1 ? 'notificación marcada' : 'notificaciones marcadas'} como leídas`,
                  );
                } else {
                  toast.info('No había notificaciones sin leer.');
                }
              } catch {
                toast.error('No se pudo marcar todas como leídas.');
              }
            }}
            disabled={!hasUnread || markAll.isPending}
            className="flex-1 sm:flex-none justify-center"
          >
            <CheckCheck className="size-3.5" />
            <span className="sm:hidden">Marcar leídas</span>
            <span className="hidden sm:inline">Marcar todas</span>
          </Button>
        </div>
      </header>

      {/* Tabs — Sprint 51.22 premium pills */}
      <div className="card-premium rounded-[var(--radius-lg)] p-1 flex items-center gap-1 self-start overflow-x-auto max-w-full">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'px-4 h-9 text-[11px] uppercase tracking-[0.08em] font-medium whitespace-nowrap shrink-0',
              'rounded-[var(--radius-sm)] transition-all duration-150',
              tab === t.id
                ? 'bg-[var(--color-accent-subtle)] text-[var(--color-fg)] shadow-[inset_0_0_0_1px_var(--color-accent)]'
                : 'text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Lista */}
      {isLoading ? (
        <LoadingList />
      ) : isError ? (
        <EmptyState
          hint="notifications"
          label="No se pudieron cargar las notificaciones."
          action={
            <Button variant="secondary" size="sm" onClick={() => refetch()}>
              Reintentar
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          hint="notifications"
          label={
            tab === 'unread'
              ? 'Estás al día — no tenés notificaciones sin leer.'
              : 'Todavía no tenés notificaciones.'
          }
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((n, i) => (
            <NotificationCard
              key={n.id}
              n={n}
              index={i}
              onMarkRead={async () => {
                try {
                  await markRead.mutateAsync(n.id);
                } catch {
                  toast.error('No se pudo marcar como leída.');
                }
              }}
              pending={markRead.isPending && markRead.variables === n.id}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function NotificationCard({
  n,
  index,
  onMarkRead,
  pending,
}: {
  n: MyNotification;
  index: number;
  onMarkRead: () => void;
  pending: boolean;
}) {
  const Icon = iconForKind(n.kind);
  const isUnread = !n.readAt;
  return (
    <li
      className={cn(
        'animate-fade-up-staggered',
        'flex gap-3 sm:gap-4 p-3 sm:p-4',
        'card-premium card-premium-hover rounded-[var(--radius-lg)]',
        isUnread && 'border-l-2 border-l-[var(--color-accent)]',
      )}
      style={{ animationDelay: `${Math.min(index * 30, 600)}ms` }}
    >
      <div
        className={cn(
          'size-9 shrink-0 flex items-center justify-center border rounded-full',
          isUnread
            ? 'bg-[var(--color-accent-subtle)] border-[var(--color-accent-border)] text-[var(--color-accent-text)]'
            : 'bg-[var(--color-bg-subtle)] border-[var(--color-border)] text-[var(--color-fg-subtle)]',
        )}
      >
        <Icon className="size-4" />
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        {/* Sprint 51.23.1 mobile fix: la fecha bajaba debajo de un título
          * largo y rompía. Ahora título+badge ocupan toda la fila, la
          * fecha va abajo (al lado del kind). Mucho más limpio en mobile. */}
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <h3
            className={cn(
              'text-[13px] sm:text-[14px] min-w-0 break-words flex-1',
              isUnread
                ? 'text-[var(--color-fg)] font-medium'
                : 'text-[var(--color-fg-muted)]',
            )}
          >
            {n.subject || n.kind}
          </h3>
          {isUnread && (
            <Badge variant="danger" dot className="shrink-0">
              nueva
            </Badge>
          )}
        </div>
        {n.body && (
          <p
            className={cn(
              'text-[12px] sm:text-[13px] leading-relaxed whitespace-pre-wrap break-words',
              isUnread
                ? 'text-[var(--color-fg-muted)]'
                : 'text-[var(--color-fg-subtle)]',
            )}
          >
            {n.body}
          </p>
        )}
        {/* Footer: en mobile, kind+fecha apilados verticalmente arriba
          * del botón full-width. En sm+ vuelve a una sola fila justify-between. */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mt-1">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-mono">
            <span>{n.kind}</span>
            <span className="text-[var(--color-fg-disabled)]">·</span>
            <span>{formatRelative(n.createdAt)}</span>
          </div>
          {isUnread && (
            <button
              type="button"
              onClick={onMarkRead}
              disabled={pending}
              className={cn(
                'inline-flex items-center justify-center gap-1.5 px-3 h-8 sm:h-7 text-[11px]',
                'rounded-[var(--radius-sm)]',
                'text-[var(--color-fg-muted)]',
                'border border-[var(--color-border)]',
                'hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] hover:border-[var(--color-border-strong)]',
                'transition-colors disabled:opacity-50',
                // Mobile: full width (apilado debajo de la fecha). Desktop: auto.
                'w-full sm:w-auto',
              )}
            >
              {pending ? (
                <span className="size-2.5 border-2 border-current border-r-transparent animate-spin rounded-full" />
              ) : (
                <Check className="size-3" />
              )}
              <span className="sm:hidden">Marcar leída</span>
              <span className="hidden sm:inline">Marcar como leída</span>
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function LoadingList() {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-24 w-full bg-[var(--color-bg-subtle)]"
        />
      ))}
    </div>
  );
}

/**
 * Formato relativo simple "hace X". Si > 7 días, fecha absoluta.
 * No traemos date-fns por una sola función — código directo.
 */
function formatRelative(iso: string): string {
  try {
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const sec = Math.floor(diffMs / 1000);
    if (sec < 60) return 'hace segundos';
    const min = Math.floor(sec / 60);
    if (min < 60) return `hace ${min} min`;
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return `hace ${hrs} h`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `hace ${days} d`;
    return d.toLocaleDateString('es-AR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}
