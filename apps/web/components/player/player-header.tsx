/**
 * PlayerHeader — header consumer-facing.
 *
 * Sprint 51.18 rediseño desktop:
 *
 *   - Antes el header tenía brand + 9 items de nav horizontal + balance
 *     + bell + display name + logout, todo apretado. Se veía mal.
 *   - Ahora la nav vive en el PlayerSidebar (desktop). El header queda
 *     liviano: brand sólo en mobile, balance pill + bell + cuenta.
 *   - En mobile el header sigue compacto (brand + balance + bell), la
 *     nav la hace PlayerBottomNav.
 *   - El display name del actor + logout pasaron al sidebar footer en
 *     desktop, así que el header de desktop tiene sólo "info del estado"
 *     (saldo + notif).
 */

'use client';

import { Bell, Gift, Wallet as WalletIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BalancePill } from '@/components/player/balance-pill';
import { useMyUnreadCount } from '@/lib/hooks/use-my-notifications';
import { useMyWallet } from '@/lib/hooks/use-wallet';
import { cn } from '@/lib/cn';

export function PlayerHeader({ logoUrl }: { logoUrl?: string | null } = {}) {
  const pathname = usePathname();
  const wallet = useMyWallet();

  return (
    <header className="border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)] sticky top-0 z-20 backdrop-blur-md">
      <div className="px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-3 sm:gap-6">
        {/* Brand — sólo mobile, en desktop el sidebar tiene el brand */}
        <Link
          href="/play"
          className="md:hidden flex items-center gap-2 hover:opacity-80 transition-opacity shrink-0"
        >
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt="Logo"
              className="h-6 w-auto max-w-[120px] object-contain"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <BrandMark />
          )}
          <span className="font-display text-base tracking-tight text-[var(--color-fg)]">
            Casino
          </span>
        </Link>

        {/* Spacer en desktop — sidebar tiene el brand, queda lugar para
          * que el right cluster vaya pegado a la derecha. */}
        <div className="hidden md:block flex-1" />

        {/* Right cluster: balance + bell */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <BalancePill
            balance={wallet.data?.balance}
            loading={wallet.isLoading}
          />
          <NotificationsBell active={pathname.startsWith('/play/notifications')} />
        </div>
      </div>
    </header>
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
