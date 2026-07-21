'use client';

/**
 * PlayerBottomNav — rediseño "Neón Milonga".
 *
 * Bottom navigation fija para mobile. 5 tabs principales del nuevo
 * diseño. La visibilidad (solo mobile) la controla el layout — acá NO
 * se pone `md:hidden`.
 *
 * Safe area: `env(safe-area-inset-bottom)` para no pisar el home
 * indicator de iOS.
 */

import { ArrowDownToLine, Gamepad2, Home, type LucideIcon, User, Wallet } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

interface NavTab {
  href: string;
  label: string;
  icon: LucideIcon;
  isActive: (pathname: string) => boolean;
  /** Si es el tab central, se renderiza con estilo destacado. */
  center?: boolean;
}

const TABS: NavTab[] = [
  {
    href: '/play/lobby',
    label: 'Juegos',
    icon: Gamepad2,
    isActive: (p) => p === '/play/lobby' || p.startsWith('/play/games'),
  },
  {
    href: '/play/wallet',
    label: 'Billetera',
    icon: Wallet,
    isActive: (p) =>
      p.startsWith('/play/wallet') ||
      p.startsWith('/play/deposits') ||
      p.startsWith('/play/withdrawals'),
  },
  {
    href: '/play',
    label: 'Casino',
    icon: Home,
    isActive: (p) => p === '/play',
    center: true,
  },
  {
    href: '/play/deposits?new=1',
    label: 'Depositar',
    icon: ArrowDownToLine,
    isActive: (p) => p.startsWith('/play/deposits'),
  },
  {
    href: '/play/settings',
    label: 'Perfil',
    icon: User,
    isActive: (p) => p.startsWith('/play/settings') || p.startsWith('/play/notifications'),
  },
];

export function PlayerBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-30 mx-auto max-w-[480px] bg-[var(--color-bg-elevated)]/95 backdrop-blur border-t border-[var(--color-border)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      aria-label="Navegación principal"
    >
      <div className="grid grid-cols-5 h-16">
        {TABS.map((tab) => {
          const active = tab.isActive(pathname);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex flex-col items-center justify-center gap-1 transition-all duration-150',
                tab.center ? 'relative' : '',
                active
                  ? 'text-[var(--color-accent-text)]'
                  : 'text-[var(--color-fg-subtle)]',
              )}
            >
              {tab.center ? (
                <div
                  className={cn(
                    'flex items-center justify-center size-11 rounded-full transition-all duration-150',
                    active
                      ? 'bg-[var(--color-accent)] text-[var(--color-accent-fg)] shadow-[0_0_16px_var(--color-accent-glow)]'
                      : 'bg-[var(--color-bg-subtle)] text-[var(--color-fg-muted)] border border-[var(--color-border)]',
                  )}
                >
                  <Icon size={20} />
                </div>
              ) : (
                <Icon size={20} />
              )}
              <span className="text-[9.5px] font-medium leading-none">
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
