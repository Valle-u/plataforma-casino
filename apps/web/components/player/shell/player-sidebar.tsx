'use client';

/**
 * PlayerSidebar — columna izquierda del shell del jugador.
 *
 * Guest mode: only shows Principal group (Casino, Juegos) + login/register CTA.
 * Auth mode: full sidebar with all groups, unread badges.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
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

export function PlayerSidebar() {
  const pathname = usePathname();
  const { user, openLoginModal, openRegisterModal } = useAuth();
  const unread = useMyUnreadCount();
  const tenantInfo = useTenantInfo();
  const branding = tenantInfo.data?.branding;
  const designBrand = tenantInfo.data?.design?.brand as { logoUrl?: string } | undefined;
  const logoUrl = branding?.logoUrl || designBrand?.logoUrl;

  const groups = user ? ALL_GROUPS : PUBLIC_GROUPS;
  const unreadCount = unread.data?.count ?? 0;

  return (
    <aside className="sticky top-0 flex h-screen w-[248px] shrink-0 flex-col overflow-y-auto border-r border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
      {/* 1) Wordmark */}
      <div className="px-5 pt-5 pb-4">
        <Link href="/play" className="block">
          <TangoWordmark size="sm" src={logoUrl} />
        </Link>
      </div>

      {/* 2) Grupos de navegación */}
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
                    className={cn(
                      'group relative flex items-center gap-2.5 rounded-[var(--radius)] px-2.5 py-2',
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

      {/* 3) Guest CTA at bottom */}
      {!user && (
        <div className="mt-auto flex flex-col gap-2 px-3 pb-5">
          <button
            type="button"
            onClick={() => openLoginModal()}
            className="flex items-center justify-center gap-2 rounded-[var(--radius)] border border-[var(--color-border)] py-2.5 text-[13px] font-medium text-[var(--color-fg)] transition-colors hover:border-[var(--color-accent-border)]"
          >
            <LogIn className="size-4" />
            Iniciar sesión
          </button>
          <button
            type="button"
            onClick={() => openRegisterModal()}
            className="flex items-center justify-center gap-2 rounded-[var(--radius)] py-2.5 text-[13px] font-semibold text-[var(--color-accent-fg)]"
            style={{ background: 'var(--gradient-accent)' }}
          >
            <UserPlus className="size-4" />
            Registrarse
          </button>
        </div>
      )}
    </aside>
  );
}
