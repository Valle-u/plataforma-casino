/**
 * Sidebar del panel admin — navegación principal.
 *
 * Composición:
 *   - Header con brand mark + nombre del tenant.
 *   - Secciones agrupadas: Operación / Engagement / Plataforma / Sistema.
 *   - Items con icono + label + indicador rojo en activo (border-l-2).
 *   - Footer: user chip + logout.
 *
 * Ancho fijo 240px desktop. En mobile (< lg) se colapsa — fase futura.
 */

'use client';

import {
  ArrowLeftRight,
  BellRing,
  Coins,
  CreditCard,
  FileText,
  Gauge,
  Gift,
  Layers,
  LayoutGrid,
  Dices,
  FileBarChart2,
  LogOut,
  Package,
  Percent,
  Settings,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentType, SVGProps } from 'react';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  {
    title: 'Operación',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: Gauge },
      { href: '/users', label: 'Usuarios', icon: Users },
      { href: '/wallet', label: 'Wallet', icon: Wallet },
      { href: '/wallet-stats', label: 'Estadísticas de pago', icon: FileBarChart2 },
      { href: '/game-stats', label: 'Estadísticas de juego', icon: Dices },
      { href: '/deposits', label: 'Depósitos', icon: ArrowLeftRight },
      { href: '/withdrawals', label: 'Retiros', icon: Coins },
    ],
  },
  {
    title: 'Engagement',
    items: [
      { href: '/bonuses', label: 'Bonos', icon: Gift },
      { href: '/bonus-definitions', label: 'Plantillas de bono', icon: Package },
      { href: '/promotions', label: 'Promociones', icon: Sparkles },
      { href: '/leagues', label: 'Ligas', icon: Trophy },
    ],
  },
  {
    title: 'Plataforma',
    items: [
      { href: '/fraud', label: 'Antifraude', icon: ShieldCheck },
      { href: '/notifications', label: 'Notificaciones', icon: BellRing },
      { href: '/audit', label: 'Audit log', icon: FileText },
    ],
  },
  {
    title: 'Sistema',
    items: [
      { href: '/permissions', label: 'Permisos', icon: Layers },
      { href: '/payment-methods', label: 'Métodos de pago', icon: CreditCard },
      { href: '/commissions', label: 'Comisiones', icon: Percent },
      { href: '/settings', label: 'Ajustes', icon: Settings },
      { href: '/templates', label: 'Plantillas', icon: LayoutGrid },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  return (
    <aside className="hidden lg:flex flex-col w-60 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-bg)]">
      {/* Brand */}
      <Link
        href="/dashboard"
        className="flex items-center gap-3 px-4 h-14 border-b border-[var(--color-border)] hover:bg-[var(--color-bg-subtle)] transition-colors"
      >
        <SidebarBrandMark />
        <div className="flex flex-col leading-tight">
          <span className="font-display text-base tracking-tight text-[var(--color-fg)]">
            Casino
          </span>
          <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
            Panel · Operador
          </span>
        </div>
      </Link>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-4 px-2 flex flex-col gap-5">
        {SECTIONS.map((section) => (
          <div key={section.title} className="flex flex-col gap-1">
            <div className="px-2 pb-1">
              <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)] font-medium">
                {section.title}
              </span>
            </div>
            {section.items.map((item) => {
              const active =
                pathname === item.href ||
                (item.href !== '/dashboard' && pathname.startsWith(item.href));
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'group relative flex items-center gap-2.5 px-2.5 py-1.5',
                    'text-[13px] transition-colors duration-150',
                    'border-l-2',
                    active
                      ? 'text-[var(--color-fg)] bg-[var(--color-bg-subtle)] border-l-[var(--color-accent)]'
                      : 'text-[var(--color-fg-muted)] border-l-transparent hover:text-[var(--color-fg)] hover:bg-[var(--color-bg-subtle)]',
                  )}
                >
                  <Icon
                    className={cn(
                      'size-3.5 shrink-0 transition-colors',
                      active
                        ? 'text-[var(--color-accent-text)]'
                        : 'text-[var(--color-fg-subtle)] group-hover:text-[var(--color-fg-muted)]',
                    )}
                  />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* User chip + logout */}
      <div className="border-t border-[var(--color-border)] p-3 flex items-center gap-2">
        <div className="size-7 border border-[var(--color-border-strong)] flex items-center justify-center text-[11px] font-mono uppercase shrink-0 bg-[var(--color-bg-subtle)]">
          {(user?.displayName ?? user?.username ?? '?').slice(0, 2)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] text-[var(--color-fg)] truncate">
            {user?.displayName ?? user?.username ?? '—'}
          </div>
          <div className="text-[10px] text-[var(--color-fg-subtle)] font-mono truncate">
            @{user?.username ?? 'guest'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => logout()}
          className="size-7 flex items-center justify-center text-[var(--color-fg-subtle)] hover:text-[var(--color-accent-text)] hover:bg-[var(--color-bg-subtle)] transition-colors"
          aria-label="Cerrar sesión"
        >
          <LogOut className="size-3.5" />
        </button>
      </div>
    </aside>
  );
}

function SidebarBrandMark() {
  return (
    <svg width="24" height="24" viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect width="32" height="32" fill="var(--color-bg-elevated)" />
      <path d="M6 6 L26 6 L26 12 L12 12 L12 20 L26 20 L26 26 L6 26 Z" fill="var(--color-fg)" />
      <rect x="22" y="6" width="4" height="6" fill="var(--color-accent)" />
      <rect x="22" y="20" width="4" height="6" fill="var(--color-accent)" />
    </svg>
  );
}
