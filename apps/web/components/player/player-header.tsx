/**
 * PlayerHeader — header consumer-facing.
 *
 * Composición:
 *   - Brand mark (link a /play).
 *   - Nav horizontal: Inicio · Wallet · Bonos · (futuras: Promos · Juegos).
 *   - Right cluster: balance pill + user dropdown (display name + logout).
 *
 * Balance se muestra inline para que el jugador siempre vea cuántas
 * chips tiene a la mano (UX clásica de plataformas de juego).
 *
 * Mobile: nav colapsa a un hamburger. Sprint futuro.
 */

'use client';

import { Bell, Coins, Gift, LogOut, Wallet as WalletIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMyUnreadCount } from '@/lib/hooks/use-my-notifications';
import { useMyWallet } from '@/lib/hooks/use-wallet';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';

interface NavItem {
  href: string;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/play', label: 'Inicio' },
  { href: '/play/wallet', label: 'Wallet' },
  { href: '/play/deposits', label: 'Depósitos' },
  { href: '/play/withdrawals', label: 'Retiros' },
  { href: '/play/bonuses', label: 'Bonos' },
  { href: '/play/wheel', label: 'Rueda' },
  { href: '/play/streak', label: 'Racha' },
];

export function PlayerHeader() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const wallet = useMyWallet();

  return (
    <header className="border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)] sticky top-0 z-30 backdrop-blur-md">
      <div className="max-w-[1100px] mx-auto px-6 h-16 flex items-center justify-between gap-6">
        {/* Brand + Nav */}
        <div className="flex items-center gap-8">
          <Link
            href="/play"
            className="flex items-center gap-2.5 hover:opacity-80 transition-opacity"
          >
            <BrandMark />
            <span className="font-display text-lg tracking-tight text-[var(--color-fg)]">
              Casino
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const active =
                pathname === item.href ||
                (item.href !== '/play' && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'px-3 h-8 flex items-center text-[13px] transition-colors',
                    active
                      ? 'text-[var(--color-fg)] border-b-2 border-b-[var(--color-accent)]'
                      : 'text-[var(--color-fg-muted)] border-b-2 border-b-transparent hover:text-[var(--color-fg)]',
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right: balance + notif bell + user */}
        <div className="flex items-center gap-4">
          <BalancePill
            balance={wallet.data?.balance}
            loading={wallet.isLoading}
          />
          <NotificationsBell active={pathname.startsWith('/play/notifications')} />
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex flex-col items-end leading-tight">
              <span className="text-[12px] text-[var(--color-fg)]">
                {user?.displayName ?? user?.username ?? '—'}
              </span>
              <span className="text-[10px] text-[var(--color-fg-subtle)] font-mono">
                @{user?.username ?? 'guest'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => logout('/play/login')}
              className="size-8 flex items-center justify-center text-[var(--color-fg-subtle)] hover:text-[var(--color-accent)] hover:bg-[var(--color-bg-subtle)] transition-colors"
              aria-label="Cerrar sesión"
              title="Cerrar sesión"
            >
              <LogOut className="size-3.5" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

function BalancePill({
  balance,
  loading,
}: {
  balance: string | undefined;
  loading: boolean;
}) {
  return (
    <Link
      href="/play/wallet"
      className={cn(
        'group flex items-center gap-2 px-3 h-9',
        'bg-[var(--color-bg)] border border-[var(--color-border-strong)]',
        'hover:border-[var(--color-accent)] transition-colors',
      )}
      title="Ir a tu wallet"
    >
      <Coins className="size-3.5 text-[var(--color-accent)]" />
      <span className="text-[13px] font-mono tabular-nums text-[var(--color-fg)]">
        {loading || !balance ? '— · — —' : Number(balance).toLocaleString('es-AR')}
      </span>
      <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
        CHIPS
      </span>
    </Link>
  );
}

/**
 * Bell + badge counter de notificaciones no leídas. El hook
 * `useMyUnreadCount` hace polling cada 30s para mantener el badge ~live.
 * Sin botón "marcar" desde acá — click navega al inbox completo donde el
 * jugador puede gestionar.
 */
function NotificationsBell({ active }: { active: boolean }) {
  const { data } = useMyUnreadCount();
  const count = data?.count ?? 0;
  const hasUnread = count > 0;
  const label = count > 99 ? '99+' : String(count);
  return (
    <Link
      href="/play/notifications"
      className={cn(
        'relative size-9 flex items-center justify-center',
        'border transition-colors',
        active
          ? 'border-[var(--color-accent)] text-[var(--color-fg)] bg-[var(--color-accent-subtle)]'
          : 'border-[var(--color-border-strong)] text-[var(--color-fg-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-fg)]',
      )}
      title={
        hasUnread
          ? `Tenés ${count} ${count === 1 ? 'notificación nueva' : 'notificaciones nuevas'}`
          : 'Notificaciones'
      }
      aria-label="Inbox de notificaciones"
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
            'rounded-sm',
          )}
        >
          {label}
        </span>
      )}
    </Link>
  );
}

function BrandMark() {
  return (
    <svg width="24" height="24" viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect width="32" height="32" fill="var(--color-bg)" />
      <path
        d="M6 6 L26 6 L26 12 L12 12 L12 20 L26 20 L26 26 L6 26 Z"
        fill="var(--color-fg)"
      />
      <rect x="22" y="6" width="4" height="6" fill="var(--color-accent)" />
      <rect x="22" y="20" width="4" height="6" fill="var(--color-accent)" />
    </svg>
  );
}

// Export icons used externally if needed.
export const _icons = { Wallet: WalletIcon, Gift };
