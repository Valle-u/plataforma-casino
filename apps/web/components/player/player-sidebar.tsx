/**
 * PlayerSidebar — Sprint 51.18.
 *
 * Sidebar permanente para desktop (>= md). Reemplaza la nav horizontal
 * que vivía en el PlayerHeader, que estaba quedando apretada con 9
 * items + el balance + bell + avatar en una sola fila.
 *
 * Estructura:
 *   - Brand en el top.
 *   - Nav agrupada por dominio (Casino / Mi dinero / Recompensas / Cuenta)
 *     — el grouping ayuda a que 9 items no se sientan una lista plana.
 *   - Footer con info del tenant + logout chico.
 *
 * Layout:
 *   - Fixed left, w-60, full-height. Sticky para que no haga scroll
 *     con el contenido — la idea es que esté siempre visible mientras
 *     el player navega.
 *   - `hidden md:flex` → mobile sigue usando PlayerBottomNav.
 *
 * Active state: cualquier ruta que empiece con el href del item lo
 * marca activo. Excepto `/play` que requiere match exacto (sino TODAS
 * las rutas /play/* lo marcarían).
 *
 * Branding del tenant: el sidebar respeta el `--color-accent` override
 * porque vive dentro del wrapper con `brandingStyle` del layout.
 */

'use client';

import {
  ArrowDownToLine,
  ArrowUpToLine,
  Coins,
  Flame,
  Gauge,
  Gift,
  Home,
  LogOut,
  Sparkles,
  User,
  Wallet as WalletIcon,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Si requiere match exacto. Default: false (startsWith). */
  exact?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  {
    label: 'Casino',
    items: [
      { href: '/play', label: 'Inicio', icon: Home, exact: true },
      { href: '/play/lobby', label: 'Juegos', icon: Gauge },
    ],
  },
  {
    label: 'Mi dinero',
    items: [
      { href: '/play/wallet', label: 'Wallet', icon: WalletIcon },
      { href: '/play/deposits', label: 'Depósitos', icon: ArrowDownToLine },
      { href: '/play/withdrawals', label: 'Retiros', icon: ArrowUpToLine },
    ],
  },
  {
    label: 'Recompensas',
    items: [
      { href: '/play/bonuses', label: 'Bonos', icon: Gift },
      { href: '/play/wheel', label: 'Ruleta diaria', icon: Sparkles },
      { href: '/play/streak', label: 'Racha', icon: Flame },
    ],
  },
  {
    label: 'Cuenta',
    items: [{ href: '/play/settings', label: 'Mi cuenta', icon: User }],
  },
];

export function PlayerSidebar({ logoUrl }: { logoUrl?: string | null }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  return (
    <aside
      className={cn(
        'hidden md:flex flex-col',
        'fixed left-0 top-0 bottom-0 z-30',
        'w-60 h-screen',
        'bg-[var(--color-bg-elevated)] border-r border-[var(--color-border)]',
        'backdrop-blur-md',
      )}
      aria-label="Navegación principal"
    >
      {/* Brand */}
      <Link
        href="/play"
        className="flex items-center gap-2.5 h-16 px-5 border-b border-[var(--color-border)] hover:opacity-80 transition-opacity shrink-0"
      >
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt="Logo"
            className="h-7 w-auto max-w-[140px] object-contain"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <BrandMark />
        )}
        <span className="font-display text-lg tracking-tight text-[var(--color-fg)]">
          Casino
        </span>
      </Link>

      {/* Nav groups con scroll si overflow */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 flex flex-col gap-5">
        {GROUPS.map((group) => (
          <div key={group.label} className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)] font-medium px-3 mb-1">
              {group.label}
            </span>
            {group.items.map((item) => {
              const active = item.exact
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(item.href + '/');
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'group flex items-center gap-3 h-9 px-3',
                    'text-[13px] tracking-tight',
                    'transition-colors duration-150',
                    'border-l-2',
                    active
                      ? 'bg-[var(--color-accent-subtle)] border-l-[var(--color-accent)] text-[var(--color-fg)]'
                      : 'border-l-transparent text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]',
                  )}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon
                    className={cn(
                      'size-4 shrink-0',
                      active
                        ? 'text-[var(--color-accent-text)]'
                        : 'text-[var(--color-fg-subtle)] group-hover:text-[var(--color-fg-muted)]',
                    )}
                  />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer: user info + logout */}
      <div className="border-t border-[var(--color-border)] p-3 flex flex-col gap-3 shrink-0">
        <div className="flex items-center gap-2.5 px-2">
          <div
            className={cn(
              'size-9 rounded-full flex items-center justify-center shrink-0',
              'bg-[var(--color-accent-subtle)] border border-[var(--color-accent-border)]',
            )}
          >
            <span className="text-[12px] font-mono font-medium text-[var(--color-accent-text)] uppercase">
              {(user?.displayName ?? user?.username ?? '?')
                .slice(0, 2)
                .toUpperCase()}
            </span>
          </div>
          <div className="flex flex-col min-w-0 flex-1 leading-tight">
            <span className="text-[12px] text-[var(--color-fg)] truncate">
              {user?.displayName ?? user?.username ?? '—'}
            </span>
            <span className="text-[10px] text-[var(--color-fg-subtle)] font-mono truncate">
              @{user?.username ?? 'guest'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => logout('/play/login')}
            className="size-8 flex items-center justify-center text-[var(--color-fg-subtle)] hover:text-[var(--color-accent-text)] hover:bg-[var(--color-bg-subtle)] transition-colors shrink-0"
            aria-label="Cerrar sesión"
            title="Cerrar sesión"
          >
            <LogOut className="size-3.5" />
          </button>
        </div>
        <div className="flex items-center gap-1.5 px-2 text-[10px] text-[var(--color-fg-subtle)]">
          <Coins className="size-2.5" />
          <span className="uppercase tracking-[0.1em]">
            Juego responsable · +18
          </span>
        </div>
      </div>
    </aside>
  );
}

function BrandMark() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden>
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
