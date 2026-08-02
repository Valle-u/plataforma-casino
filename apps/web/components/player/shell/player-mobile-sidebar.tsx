'use client';

/**
 * PlayerMobileSidebar — slide-in drawer replicating the desktop sidebar
 * navigation for mobile. Opens via a hamburger button in PlayerMobileAppBar.
 *
 * Reuses the same nav groups / active-state logic from PlayerSidebar.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import {
  CreditCard,
  Gamepad2,
  Home,
  KeyRound,
  Landmark,
  Wallet,
  Bell,
  LogIn,
  UserPlus,
  X,
} from 'lucide-react';
import { TangoWordmark } from '@/components/brand/tango-wordmark';
import { useAuth } from '@/lib/auth-context';
import { useMyUnreadCount } from '@/lib/hooks/use-my-notifications';
import { useTenantInfo } from '@/lib/hooks/use-tenant-branding';
import { cn } from '@/lib/cn';

interface NavItem {
  label: string;
  href: string;
  icon: typeof Home;
  color: string;
  badge?: string;
  exact?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const PUBLIC_GROUPS: NavGroup[] = [
  {
    label: 'Principal',
    items: [
      { label: 'Casino', href: '/play', icon: Home, color: 'var(--color-accent)', exact: true },
      { label: 'Juegos', href: '/play/lobby', icon: Gamepad2, color: 'var(--color-cyan)' },
    ],
  },
];

const ALL_GROUPS: NavGroup[] = [
  ...PUBLIC_GROUPS,
  {
    label: 'Mi dinero',
    items: [
      { label: 'Wallet', href: '/play/wallet', icon: Wallet, color: 'var(--color-success)' },
      { label: 'Depósitos', href: '/play/deposits', icon: CreditCard, color: 'var(--color-accent)' },
      { label: 'Retiros', href: '/play/withdrawals', icon: Landmark, color: 'var(--color-magenta)' },
    ],
  },
  {
    label: 'Cuenta',
    items: [
      { label: 'Notificaciones', href: '/play/notifications', icon: Bell, color: 'var(--color-warning)', badge: 'unread' },
      { label: 'Configuración', href: '/play/settings', icon: KeyRound, color: 'var(--color-fg-muted)' },
    ],
  },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + '/');
}

interface PlayerMobileSidebarProps {
  open: boolean;
  onClose: () => void;
}

export function PlayerMobileSidebar({ open, onClose }: PlayerMobileSidebarProps) {
  const pathname = usePathname();
  const { user, openLoginModal, openRegisterModal } = useAuth();
  const unread = useMyUnreadCount();
  const tenantInfo = useTenantInfo();
  const branding = tenantInfo.data?.branding;
  const designBrand = tenantInfo.data?.design?.brand as { logoUrl?: string } | undefined;
  const logoUrl = branding?.logoUrl || designBrand?.logoUrl;

  const groups = user ? ALL_GROUPS : PUBLIC_GROUPS;
  const unreadCount = unread.data?.count ?? 0;

  // Close on route change
  useEffect(() => {
    onClose();
  }, [pathname, onClose]);

  // Lock body scroll when open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-200 lg:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
        aria-hidden
      />

      {/* Drawer */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[280px] max-w-[85vw] flex-col overflow-y-auto border-r border-[var(--color-border)] bg-[var(--color-bg-elevated)] transition-transform duration-200 ease-out lg:hidden',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <Link href="/play" className="block flex-1 min-w-0" onClick={onClose}>
            <TangoWordmark size="sm" src={logoUrl} />
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="ml-3 grid size-8 shrink-0 place-items-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg-subtle)] text-[var(--color-fg-muted)] transition-colors hover:text-[var(--color-fg)]"
            aria-label="Cerrar menú"
          >
            <X size={16} />
          </button>
        </div>

        {/* Nav groups */}
        <nav className="flex-1 flex flex-col gap-4 px-3">
          {groups.map((group) => (
            <div key={group.label}>
              <span className="mb-1.5 px-2 text-[9px] font-semibold uppercase tracking-[.2em] text-[var(--color-fg-subtle)]">
                {group.label}
              </span>
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const active = isActive(pathname, item);
                  let badgeContent: string | null = null;
                  if (item.badge === 'unread' && unreadCount > 0) {
                    badgeContent = unreadCount > 99 ? '99+' : String(unreadCount);
                  }

                  return (
                    <Link
                      key={item.href + item.label}
                      href={item.href}
                      onClick={onClose}
                      className={cn(
                        'group relative flex items-center gap-2.5 rounded-[var(--radius)] px-2.5 py-2.5',
                        'text-[13px] transition-all duration-150',
                        active
                          ? 'text-[var(--color-fg)]'
                          : 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]',
                      )}
                      style={
                        active
                          ? {
                              background: `color-mix(in srgb, ${item.color} 8%, transparent)`,
                              boxShadow: `inset 3px 0 0 0 ${item.color}`,
                            }
                          : undefined
                      }
                    >
                      <span
                        className="size-[6px] shrink-0 rounded-full transition-shadow duration-200"
                        style={{
                          background: item.color,
                          boxShadow: active
                            ? `0 0 6px ${item.color}, 0 0 12px ${item.color}`
                            : `0 0 4px ${item.color}40`,
                        }}
                      />
                      <item.icon
                        size={15}
                        className="shrink-0 transition-all duration-150"
                        style={{
                          color: active ? item.color : undefined,
                          filter: active ? `drop-shadow(0 0 4px ${item.color})` : undefined,
                        }}
                      />
                      <span className="truncate flex-1">{item.label}</span>
                      {badgeContent && (
                        <span
                          className={cn(
                            'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums leading-none',
                            item.badge === 'unread'
                              ? 'text-[var(--color-accent-fg)]'
                              : 'text-[var(--color-fg-muted)] border border-[var(--color-border)]',
                          )}
                          style={
                            item.badge === 'unread'
                              ? { background: item.color }
                              : { background: 'var(--color-bg-subtle)' }
                          }
                        >
                          {badgeContent}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Guest CTA */}
        {!user && (
          <div className="mt-auto flex flex-col gap-2 px-3 pb-5">
            <button
              type="button"
              onClick={() => { onClose(); openLoginModal(); }}
              className="flex items-center justify-center gap-2 rounded-[var(--radius)] border border-[var(--color-border)] py-2.5 text-[13px] font-medium text-[var(--color-fg)] transition-colors hover:border-[var(--color-accent-border)]"
            >
              <LogIn className="size-4" />
              Iniciar sesión
            </button>
            <button
              type="button"
              onClick={() => { onClose(); openRegisterModal(); }}
              className="flex items-center justify-center gap-2 rounded-[var(--radius)] py-2.5 text-[13px] font-semibold text-[var(--color-accent-fg)]"
              style={{ background: 'var(--gradient-accent)' }}
            >
              <UserPlus className="size-4" />
              Registrarse
            </button>
          </div>
        )}
      </aside>
    </>
  );
}
