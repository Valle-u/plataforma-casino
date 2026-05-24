/**
 * PlayerHeader — header consumer-facing.
 *
 * Sprint 51.19.2 rediseño: sidebar fue, vuelve a ser solo header pero
 * con jerarquía buena, no apretado.
 *
 * Estructura desktop:
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │ [Logo] Casino   Inicio · Juegos · Mi dinero▾ · Recompensas▾  │
 *   │                                       [Saldo] [🔔] [Avatar▾] │
 *   └────────────────────────────────────────────────────────────────┘
 *
 * - Solo 4 items principales en la nav, dos con dropdown:
 *     - "Mi dinero" → Wallet, Depósitos, Retiros.
 *     - "Recompensas" → Bonos, Ruleta diaria, Racha.
 *   Distribuir 9 items en 4 hace que el header respire.
 *
 * - El avatar pasa a ser dropdown (click → name + Mi cuenta + Logout).
 *   Antes el logout estaba como botón suelto y el display name pegado.
 *
 * Estructura mobile:
 *   Brand + Saldo + Bell. La nav la hace PlayerBottomNav.
 */

'use client';

import {
  ArrowDownToLine,
  ArrowUpToLine,
  Bell,
  ChevronDown,
  Flame,
  Gift,
  LogOut,
  Settings,
  Sparkles,
  Trophy,
  Wallet as WalletIcon,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { BalancePill } from '@/components/player/balance-pill';
import { NotificationsDropdown } from '@/components/player/notifications-dropdown';
import { VipRing } from '@/components/player/vip-tier-card';
import { useMyUnreadCount } from '@/lib/hooks/use-my-notifications';
import { useMyWallet } from '@/lib/hooks/use-wallet';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';

interface NavLink {
  href: string;
  label: string;
  icon?: LucideIcon;
  exact?: boolean;
}

interface NavSection {
  /** Si tiene `items`, es dropdown. Si no, es link directo. */
  label: string;
  href?: string;
  items?: NavLink[];
  exact?: boolean;
}

const NAV: NavSection[] = [
  { label: 'Inicio', href: '/play', exact: true },
  { label: 'Juegos', href: '/play/lobby' },
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
      { href: '/play/achievements', label: 'Logros', icon: Trophy },
    ],
  },
];

export function PlayerHeader({ logoUrl }: { logoUrl?: string | null } = {}) {
  const pathname = usePathname();
  const wallet = useMyWallet();

  return (
    <header className="border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)] sticky top-0 z-30 backdrop-blur-md">
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 h-14 md:h-16 flex items-center gap-3 md:gap-8">
        {/* Brand */}
        <Link
          href="/play"
          className="flex items-center gap-2 md:gap-2.5 hover:opacity-80 transition-opacity shrink-0"
        >
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt="Logo"
              className="h-6 md:h-7 w-auto max-w-[120px] md:max-w-[140px] object-contain"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <BrandMark />
          )}
          <span className="font-display text-base md:text-lg tracking-tight text-[var(--color-fg)]">
            Casino
          </span>
        </Link>

        {/* Nav horizontal — desktop only */}
        <nav className="hidden md:flex items-center gap-1 flex-1">
          {NAV.map((section) =>
            section.items ? (
              <NavDropdown
                key={section.label}
                label={section.label}
                items={section.items}
                pathname={pathname}
              />
            ) : (
              <NavLinkItem
                key={section.href}
                href={section.href!}
                label={section.label}
                exact={section.exact}
                pathname={pathname}
              />
            ),
          )}
        </nav>

        {/* Spacer mobile para empujar el right cluster a la derecha */}
        <div className="flex-1 md:hidden" />

        {/* Right cluster: balance + bell + avatar dropdown */}
        <div className="flex items-center gap-2 md:gap-3 shrink-0">
          <BalancePill
            balance={wallet.data?.balance}
            loading={wallet.isLoading}
          />
          {/* Bell: en mobile es Link a la página completa, en desktop
            * abre el dropdown con últimas 8. Los componentes son
            * mutuamente exclusivos vía md:hidden / hidden md:block. */}
          <NotificationsBell
            active={pathname.startsWith('/play/notifications')}
          />
          <NotificationsDropdown
            active={pathname.startsWith('/play/notifications')}
            pathname={pathname}
          />
          {/* Avatar dropdown — desktop only. Mobile usa bottom nav → Cuenta */}
          <div className="hidden md:block">
            <AvatarDropdown />
          </div>
        </div>
      </div>
    </header>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Nav item (link directo, no dropdown)
// ──────────────────────────────────────────────────────────────────────

function NavLinkItem({
  href,
  label,
  exact,
  pathname,
}: {
  href: string;
  label: string;
  exact?: boolean;
  pathname: string;
}) {
  const active = exact
    ? pathname === href
    : pathname === href || pathname.startsWith(href + '/');
  return (
    <Link
      href={href}
      className={cn(
        'relative px-3 h-9 flex items-center text-[13px] tracking-tight',
        'transition-colors duration-150',
        active
          ? 'text-[var(--color-fg)]'
          : 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]',
      )}
    >
      {label}
      {active && (
        <span
          aria-hidden
          className="absolute inset-x-2 -bottom-px h-0.5 bg-[var(--color-accent)]"
        />
      )}
    </Link>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Dropdown de nav (click para abrir, click-outside / esc para cerrar)
// ──────────────────────────────────────────────────────────────────────

function NavDropdown({
  label,
  items,
  pathname,
}: {
  label: string;
  items: NavLink[];
  pathname: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // El dropdown está "activo" si alguno de sus items matchea la ruta.
  const someActive = items.some(
    (i) =>
      pathname === i.href ||
      (!i.exact && pathname.startsWith(i.href + '/')),
  );

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
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          'relative px-3 h-9 flex items-center gap-1.5 text-[13px] tracking-tight',
          'transition-colors duration-150',
          someActive || open
            ? 'text-[var(--color-fg)]'
            : 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]',
        )}
      >
        {label}
        <ChevronDown
          className={cn(
            'size-3.5 transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
        {someActive && !open && (
          <span
            aria-hidden
            className="absolute inset-x-2 -bottom-px h-0.5 bg-[var(--color-accent)]"
          />
        )}
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            'absolute left-0 top-full mt-2 min-w-[220px] z-40',
            'surface-glass rounded-[var(--radius-lg)] overflow-hidden',
            'animate-dropdown-in',
          )}
        >
          <ul className="py-1.5">
            {items.map((item) => {
              const active =
                pathname === item.href ||
                (!item.exact && pathname.startsWith(item.href + '/'));
              const Icon = item.icon;
              return (
                <li key={item.href} role="none">
                  <Link
                    href={item.href}
                    role="menuitem"
                    className={cn(
                      'flex items-center gap-3 px-3 h-9 text-[13px] tracking-tight',
                      'transition-colors duration-150 border-l-2',
                      active
                        ? 'bg-[var(--color-accent-subtle)] border-l-[var(--color-accent)] text-[var(--color-fg)]'
                        : 'border-l-transparent text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]',
                    )}
                  >
                    {Icon && (
                      <Icon
                        className={cn(
                          'size-3.5 shrink-0',
                          active
                            ? 'text-[var(--color-accent-text)]'
                            : 'text-[var(--color-fg-subtle)]',
                        )}
                      />
                    )}
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Avatar dropdown — name + Mi cuenta + Logout
// ──────────────────────────────────────────────────────────────────────

function AvatarDropdown() {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const initials = (user?.displayName ?? user?.username ?? '?')
    .slice(0, 2)
    .toUpperCase();

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
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Menú de cuenta"
        className={cn(
          'flex items-center gap-2 px-1.5 h-9',
          'rounded-[var(--radius)] btn-premium-secondary',
        )}
      >
        {/* Sprint 51.30: VipRing wraps avatar — tier silver+ shows
          * coloured ring around the initials circle. */}
        <VipRing>
          <div
            className={cn(
              'size-7 rounded-full flex items-center justify-center shrink-0',
              'bg-[var(--color-accent-subtle)] border border-[var(--color-accent-border)]',
            )}
          >
            <span className="text-[10px] font-mono font-medium text-[var(--color-accent-text)] uppercase tracking-tight">
              {initials}
            </span>
          </div>
        </VipRing>
        <ChevronDown
          className={cn(
            'size-3.5 text-[var(--color-fg-muted)] transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            'absolute right-0 top-full mt-1 min-w-[240px] z-40',
            'bg-[var(--color-bg-elevated)] border border-[var(--color-border-strong)]',
            'shadow-[0_12px_40px_-12px_rgba(0,0,0,0.8)]',
            'animate-dropdown-in',
          )}
        >
          {/* User info header */}
          <div className="px-3 py-3 border-b border-[var(--color-border)] flex items-center gap-2.5">
            <div className="size-9 rounded-full flex items-center justify-center shrink-0 bg-[var(--color-accent-subtle)] border border-[var(--color-accent-border)]">
              <span className="text-[12px] font-mono font-medium text-[var(--color-accent-text)] uppercase">
                {initials}
              </span>
            </div>
            <div className="flex flex-col min-w-0 leading-tight">
              <span className="text-[13px] text-[var(--color-fg)] truncate">
                {user?.displayName ?? user?.username ?? '—'}
              </span>
              <span className="text-[10px] text-[var(--color-fg-subtle)] font-mono truncate">
                @{user?.username ?? 'guest'}
              </span>
            </div>
          </div>
          {/* Actions */}
          <ul className="py-1.5" role="none">
            <li role="none">
              <Link
                href="/play/settings"
                role="menuitem"
                className={cn(
                  'flex items-center gap-3 px-3 h-9 text-[13px] tracking-tight',
                  'transition-colors duration-150 border-l-2',
                  pathname.startsWith('/play/settings')
                    ? 'bg-[var(--color-accent-subtle)] border-l-[var(--color-accent)] text-[var(--color-fg)]'
                    : 'border-l-transparent text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]',
                )}
              >
                <Settings className="size-3.5 text-[var(--color-fg-subtle)] shrink-0" />
                Mi cuenta
              </Link>
            </li>
            <li role="none">
              <button
                type="button"
                role="menuitem"
                onClick={() => logout('/play/login')}
                className={cn(
                  'w-full flex items-center gap-3 px-3 h-9 text-[13px] tracking-tight',
                  'transition-colors duration-150 border-l-2 border-l-transparent',
                  'text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-accent-text)]',
                )}
              >
                <LogOut className="size-3.5 text-[var(--color-fg-subtle)] shrink-0" />
                Cerrar sesión
              </button>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Bell + badge counter de notificaciones no leídas — versión mobile.
 *
 * En mobile (< md) el bell es un Link directo a /play/notifications:
 * un dropdown chiquito no encaja bien en pantallas chicas y la página
 * completa funciona mejor con touch.
 *
 * En desktop usamos NotificationsDropdown (otro componente), por eso
 * éste tiene `md:hidden`.
 *
 * `useMyUnreadCount` hace polling cada 30s para mantener el badge ~live.
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
        'md:hidden',
        'relative size-9 flex items-center justify-center',
        'border transition-colors rounded-[var(--radius)]',
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
            'rounded-full',
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
