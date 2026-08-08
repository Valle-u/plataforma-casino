/**
 * /play/notifications — Inbox (rediseño "Neón Milonga", Casino TANGO).
 *
 * Pantalla "Notificaciones" del handoff. El chrome lo provee play/layout.tsx.
 *
 * Composición:
 *   - Header: kicker "Inbox" + título + Refrescar + "Marcar todas".
 *   - Tabs: Todas / No leídas (con conteo).
 *   - Lista de filas: icono coloreado por kind + asunto + cuerpo + tiempo
 *     relativo + dot cian si está sin leer. Click en fila no leída → marca leída.
 *
 * Función PRESERVADA:
 *   - useMyNotifications (GET /tenant/notifications/me).
 *   - useMarkNotificationRead / useMarkAllNotificationsRead.
 *   - Refrescar + estados loading/error/empty.
 *
 * Cambio: traemos todas una vez y filtramos client-side → conteos en cada
 * tab + cambio instantáneo (antes refetch por tab).
 */

'use client';

import {
  Bell,
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

function iconForKind(kind: string): LucideIcon {
  if (kind.startsWith('deposit')) return CircleDollarSign;
  if (kind.startsWith('withdrawal')) return Coins;
  if (kind.startsWith('bonus')) return Gift;
  if (kind.startsWith('promotion') || kind.startsWith('promo')) return Sparkles;
  if (kind.startsWith('league')) return Trophy;
  if (kind.startsWith('fraud')) return ShieldAlert;
  return Bell;
}

function colorForKind(kind: string): string {
  if (kind.startsWith('deposit')) return 'var(--color-success)';
  if (kind.startsWith('withdrawal')) return 'var(--color-accent)';
  if (kind.startsWith('bonus')) return 'var(--color-gold)';
  if (kind.startsWith('promotion') || kind.startsWith('promo'))
    return 'var(--color-magenta)';
  if (kind.startsWith('league')) return 'var(--color-purple)';
  if (kind.startsWith('fraud')) return 'var(--color-danger)';
  return 'var(--color-cyan)';
}

export default function PlayNotificationsPage() {
  const [tab, setTab] = useState<Tab>('all');
  const { data, isLoading, isError, refetch, isFetching } = useMyNotifications({
    limit: 50,
  });
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const items = useMemo(() => data?.data ?? [], [data]);
  const counts = useMemo(
    () => ({
      all: items.length,
      unread: items.filter((n) => !n.readAt).length,
    }),
    [items],
  );
  const hasUnread = counts.unread > 0;

  const filtered = useMemo(
    () => (tab === 'unread' ? items.filter((n) => !n.readAt) : items),
    [items, tab],
  );

  async function handleMarkAll() {
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
  }

  return (
    <div className="flex flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent-text)]">
            <Bell className="size-3" />
            Inbox
          </span>
          <h1 className="font-display text-[34px] leading-none">Notificaciones</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="md"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={cn('size-3.5', isFetching && 'animate-spin')} />
            <span className="hidden sm:inline">Refrescar</span>
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={handleMarkAll}
            disabled={!hasUnread || markAll.isPending}
          >
            <CheckCheck className="size-3.5" />
            Marcar todas
          </Button>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {(['all', 'unread'] as Tab[]).map((t) => {
          const active = tab === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-pressed={active}
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-medium transition-colors',
                active
                  ? 'text-[var(--color-accent-fg)]'
                  : 'border border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] hover:border-[var(--color-accent-border)] hover:text-[var(--color-fg)]',
              )}
              style={active ? { background: 'var(--gradient-accent)' } : undefined}
            >
              {t === 'all' ? 'Todas' : 'No leídas'}
              <span
                className={cn(
                  'text-[11px] tabular-nums',
                  active ? 'opacity-80' : 'text-[var(--color-fg-subtle)]',
                )}
              >
                {t === 'all' ? counts.all : counts.unread}
              </span>
            </button>
          );
        })}
      </div>

      {/* Lista */}
      {isLoading ? (
        <LoadingList />
      ) : isError ? (
        <EmptyState
          label="Ups, no pudimos cargar tus notificaciones."
          description="Esperá unos segundos y probá de nuevo."
          action={
            <Button variant="secondary" size="sm" onClick={() => refetch()}>
              Reintentar
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-6">
          <EmptyState
            label={
              tab === 'unread'
                ? 'Estás al día — no tenés notificaciones sin leer.'
                : 'Todavía no tenés notificaciones.'
            }
            description={
              tab === 'unread'
                ? 'Cuando recibas novedades, las vas a ver acá.'
                : undefined
            }
          />
        </div>
      ) : (
        <ul className="divide-y divide-[var(--color-border)] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
          {filtered.map((n) => (
            <NotificationRow
              key={n.id}
              n={n}
              onMarkRead={async () => {
                try {
                  await markRead.mutateAsync(n.id);
                } catch {
                  toast.error('No se pudo marcar como leída.');
                }
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function NotificationRow({
  n,
  onMarkRead,
}: {
  n: MyNotification;
  onMarkRead: () => void;
}) {
  const Icon = iconForKind(n.kind);
  const tone = colorForKind(n.kind);
  const isUnread = !n.readAt;

  return (
    <li
      onClick={isUnread ? onMarkRead : undefined}
      className={cn(
        'flex items-center gap-3 px-4 py-3.5 transition-colors',
        isUnread && 'cursor-pointer hover:bg-[var(--color-bg-hover)]',
      )}
      title={isUnread ? 'Marcar como leída' : undefined}
    >
      {/* Icono coloreado por kind */}
      <span
        className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-sm)]"
        style={{
          background: `color-mix(in srgb, ${tone} 22%, transparent)`,
          color: tone,
          boxShadow: isUnread ? `0 0 12px -4px ${tone}` : undefined,
        }}
        aria-hidden
      >
        <Icon className="size-4" />
      </span>

      {/* Asunto + cuerpo */}
      <div className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            'truncate text-[14px]',
            isUnread
              ? 'font-medium text-[var(--color-fg)]'
              : 'text-[var(--color-fg-muted)]',
          )}
        >
          {n.subject || n.kind}
        </span>
        {n.body && (
          <span className="truncate text-[12px] text-[var(--color-fg-subtle)]">
            {n.body}
          </span>
        )}
      </div>

      {/* Tiempo relativo */}
      <span className="shrink-0 text-[11px] text-[var(--color-fg-subtle)]">
        {formatRelative(n.createdAt)}
      </span>

      {/* Dot no leída */}
      {isUnread && (
        <span
          className="size-2 shrink-0 rounded-full"
          style={{
            background: 'var(--color-accent-text)',
            boxShadow: '0 0 8px var(--color-accent-text)',
          }}
          aria-label="Sin leer"
        />
      )}
    </li>
  );
}

function LoadingList() {
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full bg-[var(--color-bg-subtle)]" />
      ))}
    </div>
  );
}

function formatRelative(iso: string): string {
  try {
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const sec = Math.floor(diffMs / 1000);
    if (sec < 60) return 'recién';
    const min = Math.floor(sec / 60);
    if (min < 60) return `hace ${min} min`;
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return `hace ${hrs} h`;
    const days = Math.floor(hrs / 24);
    if (days === 1) return 'ayer';
    if (days < 7) return `hace ${days} d`;
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
  } catch {
    return iso;
  }
}
