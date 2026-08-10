'use client';

/**
 * PlayerBottomNav — bottom navigation fija para mobile.
 *
 * Guest mode: Casino, Juegos, Registrarse (center CTA).
 * Auth mode: Juegos, Billetera, Casino, Depositar, Retirar.
 * (Perfil y notificaciones quedan en la appbar: avatar + campana.)
 */

import { ArrowDownToLine, ArrowUpToLine, Gamepad2, Home, UserRound, UserPlus, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';

interface NavTab {
  href?: string;
  label: string;
  icon: LucideIcon;
  isActive: (pathname: string) => boolean;
  center?: boolean;
  onClick?: () => void;
}

const AUTH_TABS: NavTab[] = [
  {
    href: '/play/lobby',
    label: 'Juegos',
    icon: Gamepad2,
    isActive: (p) => p === '/play/lobby' || p.startsWith('/play/games'),
  },
  {
    href: '/play/account',
    label: 'Mi cuenta',
    icon: UserRound,
    isActive: (p) => p === '/play/account',
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
    href: '/play/withdrawals?new=1',
    label: 'Retirar',
    icon: ArrowUpToLine,
    isActive: (p) => p.startsWith('/play/withdrawals'),
  },
];

export function PlayerBottomNav() {
  const pathname = usePathname();
  const { user, openRegisterModal } = useAuth();

  if (!user) {
    const publicTabs: NavTab[] = [
      {
        href: '/play',
        label: 'Casino',
        icon: Home,
        isActive: (p) => p === '/play',
        center: true,
      },
      {
        href: '/play/lobby',
        label: 'Juegos',
        icon: Gamepad2,
        isActive: (p) => p === '/play/lobby' || p.startsWith('/play/games'),
      },
      {
        label: 'Registrarse',
        icon: UserPlus,
        isActive: () => false,
        onClick: () => openRegisterModal(),
      },
    ];
    return (
      <nav
        className="fixed bottom-0 inset-x-0 z-30 mx-auto max-w-[480px] bg-[var(--color-bg-elevated)]/95 backdrop-blur border-t border-[var(--color-border)]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        aria-label="Navegación principal"
      >
        <div className="grid grid-cols-3 h-16">
          {publicTabs.map((tab) => {
            const active = tab.isActive(pathname);
            const Icon = tab.icon;
            const content = (
              <>
                {tab.center ? (
                  <div className={cn(
                    'flex items-center justify-center size-11 rounded-full transition-all duration-150',
                    active
                      ? 'bg-[var(--color-accent)] text-[var(--color-accent-fg)] shadow-[0_0_16px_var(--color-accent-glow)]'
                      : 'bg-[var(--color-bg-subtle)] text-[var(--color-fg-muted)] border border-[var(--color-border)]',
                  )}>
                    <Icon size={20} />
                  </div>
                ) : (
                  <Icon size={20} />
                )}
                <span className="text-[9.5px] font-medium leading-none">{tab.label}</span>
              </>
            );
            if (tab.onClick) {
              return (
                <button
                  key={tab.label}
                  type="button"
                  onClick={tab.onClick}
                  className={cn(
                    'flex flex-col items-center justify-center gap-1 transition-all duration-150',
                    active ? 'text-[var(--color-accent-text)]' : 'text-[var(--color-fg-subtle)]',
                  )}
                >
                  {content}
                </button>
              );
            }
            return (
              <Link
                key={tab.href}
                href={tab.href!}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center justify-center gap-1 transition-all duration-150',
                  active ? 'text-[var(--color-accent-text)]' : 'text-[var(--color-fg-subtle)]',
                )}
              >
                {content}
              </Link>
            );
          })}
        </div>
      </nav>
    );
  }

  const cols = 'grid-cols-5';

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-30 mx-auto max-w-[480px] bg-[var(--color-bg-elevated)]/95 backdrop-blur border-t border-[var(--color-border)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      aria-label="Navegación principal"
    >
      <div className={`grid ${cols} h-16`}>
        {AUTH_TABS.map((tab) => {
          const active = tab.isActive(pathname);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href!}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex flex-col items-center justify-center gap-1 transition-all duration-150',
                tab.center ? 'relative' : '',
                active ? 'text-[var(--color-accent-text)]' : 'text-[var(--color-fg-subtle)]',
              )}
            >
              {tab.center ? (
                <div className={cn(
                  'flex items-center justify-center size-11 rounded-full transition-all duration-150',
                  active
                    ? 'bg-[var(--color-accent)] text-[var(--color-accent-fg)] shadow-[0_0_16px_var(--color-accent-glow)]'
                    : 'bg-[var(--color-bg-subtle)] text-[var(--color-fg-muted)] border border-[var(--color-border)]',
                )}>
                  <Icon size={20} />
                </div>
              ) : (
                <Icon size={20} />
              )}
              <span className="text-[9.5px] font-medium leading-none">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
