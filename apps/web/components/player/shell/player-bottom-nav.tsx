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

import { Gamepad2, Gift, Home, type LucideIcon, User, Wallet } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavTab {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Resuelve el estado activo del tab según el pathname actual. */
  isActive: (pathname: string) => boolean;
}

const TABS: NavTab[] = [
  {
    href: '/play',
    label: 'Casino',
    icon: Home,
    isActive: (p) => p === '/play',
  },
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
    href: '/play/bonuses',
    label: 'Bonos',
    icon: Gift,
    isActive: (p) =>
      p.startsWith('/play/bonuses') ||
      p.startsWith('/play/wheel') ||
      p.startsWith('/play/streak') ||
      p.startsWith('/play/achievements'),
  },
  {
    href: '/play/settings',
    label: 'Perfil',
    icon: User,
    isActive: (p) => p.startsWith('/play/settings'),
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
              className={`flex flex-col items-center justify-center gap-1 transition-colors ${
                active
                  ? 'text-[var(--color-accent-text)]'
                  : 'text-[var(--color-fg-subtle)]'
              }`}
            >
              <Icon
                size={20}
                style={
                  active
                    ? { filter: 'drop-shadow(0 0 6px rgba(87,230,255,.7))' }
                    : undefined
                }
              />
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
