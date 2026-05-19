/**
 * /play/notifications â€” inbox del jugador.
 *
 * ComposiciÃ³n:
 *   - Header con counter total + botÃ³n "Marcar todas como leÃ­das".
 *   - Tabs: Todas / No leÃ­das.
 *   - Lista vertical de cards: icono por kind + subject + body + timestamp
 *     + badge "no leÃ­da" + botÃ³n inline para marcar.
 *
 * Endpoint:
 *   - GET /tenant/notifications/me?onlyUnread=
 *   - POST /tenant/notifications/me/:id/read
 *   - POST /tenant/notifications/me/read-all
 *
 * Comportamiento UX:
 *   - El badge "no leÃ­da" desaparece tras click (optimistic UI vÃ­a
 *     invalidate de la query â†’ refetch automÃ¡tico).
 *   - "Marcar todas" deshabilitado si no hay no-leÃ­das.
 *   - Sin paginaciÃ³n todavÃ­a â€” limit 50 cubre el caso tÃ­pico. Si emerge
 *     necesidad real (jugador power-user con 100+ notifs), sumar MÃ¡s/load-more.
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
  { id: 'unread', label: 'No leÃ­das' },
];

/**
 * Heuristic por prefix del `kind` para elegir un icono. Si emerge un kind
 * nuevo sin match, cae al Bell genÃ©rico. No crÃ­tico â€” el subject ya
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
    <div className="max-w-[1100px] mx-auto px-6 py-10 flex flex-col gap-8">
      {/* Header */}
      <header className="flex items-end justify-between gap-6 pb-2">
        <div className="flex flex-col gap-2">
          <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
            <Bell className="size-3" />
            Inbox
          </span>
          <h1 className="font-display text-[2.5rem] leading-none tracking-tight">
            Notificaciones
          </h1>
          <p className="text-sm text-[var(--color-fg-muted)] mt-1">
            {data
              ? items.length === 0
                ? 'Sin notificaciones por ahora.'
                : `${items.length} notificaciones${tab === 'unread' ? ' sin leer' : ''}`
              : 'Cargandoâ€¦'}
          </p>
        </div>
        <div className="flex items-center gap-2">
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
          <Button
            variant="primary"
            size="md"
            onClick={async () => {
              try {
                const res = await markAll.mutateAsync();
                if (res.updated > 0) {
                  toast.success(
                    `${res.updated} ${res.updated === 1 ? 'notificaciÃ³n marcada' : 'notificaciones marcadas'} como leÃ­das`,
                  );
                } else {
                  toast.info('No habÃ­a notificaciones sin leer.');
                }
              } catch {
                toast.error('No se pudo marcar todas como leÃ­das.');
              }
            }}
            disabled={!hasUnread || markAll.isPending}
          >
            <CheckCheck className="size-3.5" />
            Marcar todas
          </Button>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex items-center gap-px bg-[var(--color-border)] border border-[var(--color-border)] self-start">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'px-4 h-8 text-[11px] uppercase tracking-[0.08em] font-medium',
              'transition-colors duration-150',
              tab === t.id
                ? 'bg-[var(--color-bg)] text-[var(--color-fg)] border-b-2 border-b-[var(--color-accent)]'
                : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]',
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
              ? 'EstÃ¡s al dÃ­a â€” no tenÃ©s notificaciones sin leer.'
              : 'TodavÃ­a no tenÃ©s notificaciones.'
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
                  toast.error('No se pudo marcar como leÃ­da.');
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
        'flex gap-4 p-4',
        'bg-[var(--color-bg-elevated)] border',
        isUnread
          ? 'border-l-2 border-l-[var(--color-accent)] border-[var(--color-border)]'
          : 'border-[var(--color-border)]',
      )}
      style={{ animationDelay: `${Math.min(index * 30, 600)}ms` }}
    >
      <div
        className={cn(
          'size-9 shrink-0 flex items-center justify-center border',
          isUnread
            ? 'bg-[var(--color-accent-subtle)] border-[var(--color-accent-border)] text-[var(--color-accent-text)]'
            : 'bg-[var(--color-bg-subtle)] border-[var(--color-border)] text-[var(--color-fg-subtle)]',
        )}
      >
        <Icon className="size-4" />
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <h3
              className={cn(
                'text-[14px] truncate',
                isUnread
                  ? 'text-[var(--color-fg)] font-medium'
                  : 'text-[var(--color-fg-muted)]',
              )}
            >
              {n.subject || n.kind}
            </h3>
            {isUnread && (
              <Badge variant="danger" dot>
                nueva
              </Badge>
            )}
          </div>
          <span className="text-[11px] font-mono text-[var(--color-fg-subtle)] shrink-0">
            {formatRelative(n.createdAt)}
          </span>
        </div>
        {n.body && (
          <p
            className={cn(
              'text-[13px] leading-relaxed whitespace-pre-wrap',
              isUnread
                ? 'text-[var(--color-fg-muted)]'
                : 'text-[var(--color-fg-subtle)]',
            )}
          >
            {n.body}
          </p>
        )}
        <div className="flex items-center justify-between mt-1">
          <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-mono">
            {n.kind}
          </span>
          {isUnread && (
            <button
              type="button"
              onClick={onMarkRead}
              disabled={pending}
              className={cn(
                'inline-flex items-center gap-1.5 px-2 h-7 text-[11px]',
                'text-[var(--color-fg-muted)]',
                'border border-[var(--color-border)]',
                'hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]',
                'transition-colors disabled:opacity-50',
              )}
            >
              {pending ? (
                <span className="size-2.5 border-2 border-current border-r-transparent animate-spin rounded-full" />
              ) : (
                <Check className="size-3" />
              )}
              Marcar como leÃ­da
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
 * Formato relativo simple "hace X". Si > 7 dÃ­as, fecha absoluta.
 * No traemos date-fns por una sola funciÃ³n â€” cÃ³digo directo.
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
