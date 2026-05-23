/**
 * NotificationsDropdown — Sprint 51.20.
 *
 * Desktop: el bell del header abre este dropdown con las últimas 8
 * notifs, sin obligar al usuario a salir de la página actual.
 *
 * Mobile (< md): el bell sigue siendo un Link a /play/notifications
 * (página completa). El dropdown no se monta en mobile — el viewport es
 * chico y la página entera funciona mejor que un menú flotante.
 *
 * Features:
 *   - Header con título + "Marcar todas leídas" (sólo si hay unread).
 *   - Lista de últimas 8: ícono por kind, subject (medio), body (snippet
 *     1 línea), time-ago, dot indicator unread.
 *   - Click en un item → marca como leído (mutation) + queda en el
 *     dropdown (no navega — el dropdown sirve para "scan rápido", no
 *     para profundizar; si quieren ir a detail, hay "Ver todas").
 *   - Footer con "Ver todas →" a /play/notifications.
 *   - Empty state: copy amable.
 *   - Loading: 3 skeleton rows.
 *
 * Estilo: usa .surface-glass del DS (backdrop-blur + sombra fuerte) para
 * sentirse premium flotando sobre el bg con orbs.
 */

'use client';

import {
  ArrowUpRight,
  Bell,
  CheckCheck,
  Coins,
  Flame,
  Gift,
  Inbox,
  Megaphone,
  Sparkles,
  Trophy,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useMyNotifications,
  useMyUnreadCount,
  type MyNotification,
} from '@/lib/hooks/use-my-notifications';
import { cn } from '@/lib/cn';

/** Mapeo best-effort de kind → icon. Caemos en Bell si no matcheamos. */
function iconForKind(kind: string): { Icon: LucideIcon; color: string } {
  const k = kind.toLowerCase();
  if (k.includes('deposit')) return { Icon: Coins, color: '#22c55e' };
  if (k.includes('withdraw')) return { Icon: Coins, color: '#f59e0b' };
  if (k.includes('wheel') || k.includes('spin'))
    return { Icon: Sparkles, color: '#FFD700' };
  if (k.includes('streak')) return { Icon: Flame, color: '#FF6B35' };
  if (k.includes('bonus') || k.includes('promo'))
    return { Icon: Gift, color: '#FFD700' };
  if (k.includes('league')) return { Icon: Trophy, color: '#FFD700' };
  if (k.includes('announce') || k.includes('system'))
    return { Icon: Megaphone, color: 'var(--color-accent)' };
  return { Icon: Bell, color: 'var(--color-fg-muted)' };
}

export function NotificationsDropdown({
  active,
  pathname,
}: {
  active: boolean;
  pathname: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data: unreadData } = useMyUnreadCount();
  const count = unreadData?.count ?? 0;
  const hasUnread = count > 0;
  const badgeLabel = count > 99 ? '99+' : String(count);

  // Sólo fetch del listing si el dropdown está abierto (ahorra requests).
  const notifsQuery = useMyNotifications(open ? { limit: 8 } : {});
  const list = open ? (notifsQuery.data?.data ?? []) : [];

  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  // Click-outside + ESC
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Cerrar al navegar
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div ref={ref} className="relative hidden md:block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Inbox de notificaciones"
        className={cn(
          'relative size-9 flex items-center justify-center',
          'border transition-colors rounded-[var(--radius)]',
          active || open
            ? 'border-[var(--color-accent)] text-[var(--color-fg)] bg-[var(--color-accent-subtle)]'
            : 'border-[var(--color-border-strong)] text-[var(--color-fg-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-fg)]',
        )}
        title={
          hasUnread
            ? `Tenés ${count} ${count === 1 ? 'notificación nueva' : 'notificaciones nuevas'}`
            : 'Notificaciones'
        }
      >
        <Bell className="size-4" />
        {hasUnread && (
          <span
            className={cn(
              'absolute -top-1 -right-1',
              'min-w-[18px] h-[18px] px-1',
              'flex items-center justify-center',
              'bg-[var(--color-accent)] text-[var(--color-accent-fg)]',
              'text-[10px] font-mono font-medium tabular-nums leading-none',
              'border border-[var(--color-bg-elevated)]',
              'rounded-full',
            )}
          >
            {badgeLabel}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            'absolute right-0 top-full mt-2 z-40',
            'w-[380px] max-w-[calc(100vw-2rem)]',
            'surface-glass rounded-[var(--radius-lg)] overflow-hidden',
            'animate-dropdown-in',
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--color-border)]">
            <div className="flex items-center gap-2">
              <Inbox className="size-3.5 text-[var(--color-fg-muted)]" />
              <span className="text-[12px] uppercase tracking-[0.12em] font-medium text-[var(--color-fg)]">
                Notificaciones
              </span>
              {hasUnread && (
                <span className="text-[10px] font-mono tabular-nums px-1.5 h-4 inline-flex items-center bg-[var(--color-accent)] text-[var(--color-accent-fg)] rounded-full">
                  {badgeLabel}
                </span>
              )}
            </div>
            {hasUnread && (
              <button
                type="button"
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
                className={cn(
                  'inline-flex items-center gap-1 text-[11px] tracking-tight',
                  'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                  'transition-colors',
                )}
              >
                <CheckCheck className="size-3" />
                Marcar leídas
              </button>
            )}
          </div>

          {/* Body */}
          <div className="max-h-[420px] overflow-y-auto">
            {notifsQuery.isLoading ? (
              <SkeletonList />
            ) : list.length === 0 ? (
              <EmptyState />
            ) : (
              <ul className="divide-y divide-[var(--color-border)]">
                {list.map((n) => (
                  <NotificationItem
                    key={n.id}
                    notif={n}
                    onMarkRead={() => {
                      if (!n.readAt) markRead.mutate(n.id);
                    }}
                  />
                ))}
              </ul>
            )}
          </div>

          {/* Footer */}
          <Link
            href="/play/notifications"
            className={cn(
              'flex items-center justify-between gap-2 px-4 py-3',
              'border-t border-[var(--color-border)]',
              'text-[12px] font-medium tracking-tight',
              'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]',
              'hover:bg-[var(--color-bg-subtle)] transition-colors',
              'group/footer',
            )}
          >
            <span>Ver todas las notificaciones</span>
            <ArrowUpRight className="size-3.5 group-hover/footer:translate-x-0.5 group-hover/footer:-translate-y-0.5 transition-transform" />
          </Link>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Sub-componentes
// ──────────────────────────────────────────────────────────────────────

function NotificationItem({
  notif,
  onMarkRead,
}: {
  notif: MyNotification;
  onMarkRead: () => void;
}) {
  const isUnread = !notif.readAt;
  const { Icon, color } = iconForKind(notif.kind);
  return (
    <li>
      <button
        type="button"
        onClick={onMarkRead}
        className={cn(
          'w-full text-left px-4 py-3 flex items-start gap-3',
          'transition-colors duration-150',
          'hover:bg-[var(--color-bg-subtle)]',
          isUnread && 'bg-[var(--color-accent-subtle)]/40',
        )}
      >
        <div
          className="size-9 rounded-full flex items-center justify-center shrink-0"
          style={{
            background: `linear-gradient(135deg, ${color}25, ${color}08)`,
            border: `1px solid ${color}40`,
          }}
        >
          <Icon className="size-4" style={{ color }} />
        </div>
        <div className="flex flex-col min-w-0 flex-1 gap-0.5">
          <div className="flex items-start justify-between gap-2">
            <span
              className={cn(
                'text-[13px] tracking-tight truncate',
                isUnread
                  ? 'text-[var(--color-fg)] font-medium'
                  : 'text-[var(--color-fg-muted)]',
              )}
            >
              {notif.subject}
            </span>
            {isUnread && (
              <span
                className="size-2 rounded-full shrink-0 mt-1.5"
                style={{ background: color }}
                aria-label="No leído"
              />
            )}
          </div>
          <p className="text-[11px] text-[var(--color-fg-muted)] leading-snug line-clamp-2">
            {notif.body}
          </p>
          <span className="text-[10px] font-mono text-[var(--color-fg-subtle)] mt-0.5">
            {timeAgo(notif.createdAt)}
          </span>
        </div>
      </button>
    </li>
  );
}

function SkeletonList() {
  return (
    <ul className="divide-y divide-[var(--color-border)]">
      {[0, 1, 2].map((i) => (
        <li
          key={i}
          className="px-4 py-3 flex items-start gap-3"
          aria-hidden
        >
          <div className="size-9 rounded-full bg-[var(--color-bg-subtle)] animate-shimmer shrink-0" />
          <div className="flex flex-col gap-1.5 flex-1">
            <div className="h-3 w-2/3 bg-[var(--color-bg-subtle)] animate-shimmer rounded-sm" />
            <div className="h-2.5 w-full bg-[var(--color-bg-subtle)] animate-shimmer rounded-sm" />
            <div className="h-2.5 w-1/3 bg-[var(--color-bg-subtle)] animate-shimmer rounded-sm" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function EmptyState() {
  return (
    <div className="px-6 py-10 flex flex-col items-center gap-2 text-center">
      <div className="size-10 rounded-full bg-[var(--color-bg-subtle)] flex items-center justify-center">
        <Inbox className="size-5 text-[var(--color-fg-disabled)]" />
      </div>
      <p className="text-[12px] text-[var(--color-fg-muted)]">
        Sin notificaciones por ahora.
      </p>
      <p className="text-[10px] text-[var(--color-fg-subtle)]">
        Te avisamos cuando haya novedades.
      </p>
    </div>
  );
}

/**
 * Time-ago en español, granularidad humana. "ahora" / "hace 5 min" /
 * "hace 3 h" / "ayer" / "hace 4 d" / fecha completa para > 30 días.
 */
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diffMs = Date.now() - then;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'ahora';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `hace ${diffHr} h`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return 'ayer';
  if (diffDay < 30) return `hace ${diffDay} d`;
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'short',
  });
}
