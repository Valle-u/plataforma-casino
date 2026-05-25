/**
 * Sidebar del panel admin — navegación principal.
 *
 * Composición:
 *   - Header con brand mark + nombre del tenant (sticky top).
 *   - Secciones agrupadas y colapsables: Operativa / Engagement /
 *     Trazabilidad y negocio / Sistema.
 *   - Items con icono + label + indicador rojo en activo (border-l-2).
 *   - Footer: user chip + logout (sticky bottom).
 *
 * Sprint 51.9: layout sticky.
 *   - El `<aside>` es `sticky top-0 h-screen` desde el admin layout,
 *     con `overflow-y-auto` — UNA sola scrollbar para todo el panel
 *     izquierdo (brand + nav + user chip se mueven juntos).
 *   - Cuando el viewport es alto, no aparece scrollbar (todo entra).
 *
 * Sprint 51.9: secciones colapsables con persistencia.
 *   - Estado por sección en `localStorage` con key `sidebar.collapsed.<id>`.
 *   - Default: todas abiertas. Click en header de sección → toggle.
 *   - Si el item activo está dentro de una sección colapsada, la
 *     forzamos abierta automáticamente.
 *
 * Ancho fijo 240px desktop. En mobile (< lg) se colapsa — fase futura.
 */

'use client';

import {
  ArrowLeftRight,
  BarChart3,
  BellRing,
  Briefcase,
  Building2,
  ChevronRight,
  Coins,
  CreditCard,
  Dices,
  FileBarChart2,
  FileText,
  Gauge,
  Gift,
  Layers,
  LayoutGrid,
  Landmark,
  LogOut,
  Package,
  Percent,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  Store,
  Trophy,
  Users,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ComponentType, type SVGProps } from 'react';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

interface NavSection {
  id: string;
  title: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  items: NavItem[];
}

// Sprint 53.2: exportado para reuso en MobileNav (mismo source-of-truth
// de nav que el sidebar desktop).
export const SECTIONS: NavSection[] = [
  {
    id: 'operativa',
    title: 'Operativa',
    icon: Briefcase,
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: Gauge },
      { href: '/users', label: 'Usuarios', icon: Users },
      { href: '/wallet', label: 'Wallet', icon: Wallet },
      { href: '/deposits', label: 'Depósitos', icon: ArrowLeftRight },
      { href: '/withdrawals', label: 'Retiros', icon: Coins },
      { href: '/bank-transactions', label: 'Transferencias', icon: Landmark },
      { href: '/branches', label: 'Sucursales', icon: Store },
      { href: '/my-branch', label: 'Mi sucursal', icon: Building2 },
    ],
  },
  {
    id: 'engagement',
    title: 'Engagement',
    icon: Sparkles,
    items: [
      { href: '/bonuses', label: 'Bonos', icon: Gift },
      { href: '/bonus-definitions', label: 'Plantillas de bono', icon: Package },
      { href: '/promotions', label: 'Promociones', icon: Sparkles },
      { href: '/leagues', label: 'Ligas', icon: Trophy },
    ],
  },
  {
    id: 'trazabilidad',
    title: 'Trazabilidad y negocio',
    icon: BarChart3,
    items: [
      { href: '/wallet-stats', label: 'Stats de pago', icon: FileBarChart2 },
      { href: '/game-stats', label: 'Stats de juego', icon: Dices },
      { href: '/fraud', label: 'Antifraude', icon: ShieldCheck },
      { href: '/audit', label: 'Audit log', icon: FileText },
      { href: '/notifications', label: 'Notificaciones', icon: BellRing },
    ],
  },
  {
    id: 'sistema',
    title: 'Sistema',
    icon: Server,
    items: [
      { href: '/permissions', label: 'Permisos', icon: Layers },
      { href: '/payment-methods', label: 'Métodos de pago', icon: CreditCard },
      { href: '/commissions', label: 'Comisiones', icon: Percent },
      { href: '/settings', label: 'Ajustes', icon: Settings },
      { href: '/templates', label: 'Plantillas', icon: LayoutGrid },
    ],
  },
];

const STORAGE_KEY = 'sidebar.collapsed.v1';

// Sprint 53.2: exportado para reuso en MobileNav.
export function isItemActive(itemHref: string, pathname: string): boolean {
  return (
    pathname === itemHref ||
    (itemHref !== '/dashboard' && pathname.startsWith(itemHref))
  );
}

function loadCollapsed(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function saveCollapsed(state: Record<string, boolean>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore (quota / disabled storage) */
  }
}

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  // Persistencia colapsable. Inicializamos vacío en SSR para no romper
  // hydration; la primera render del cliente lee el localStorage.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setCollapsed(loadCollapsed());
  }, []);

  const toggleSection = (id: string): void => {
    setCollapsed((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      saveCollapsed(next);
      return next;
    });
  };

  return (
    <aside className="hidden lg:flex flex-col w-60 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-bg)] sticky top-0 h-screen overflow-y-auto">
      {/* Brand */}
      <Link
        href="/dashboard"
        className="flex items-center gap-3 px-4 h-14 shrink-0 border-b border-[var(--color-border)] hover:bg-[var(--color-bg-subtle)] transition-colors"
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

      {/* Nav — UNA scrollbar única para todo el aside (no overflow propio
          acá; el aside es el contenedor scrollable). */}
      <nav className="flex-1 py-3 px-2 flex flex-col gap-2">
        {SECTIONS.map((section) => {
          // Si algún item de la sección está activo, forzar abierta —
          // evita que el item activo quede invisible bajo una sección
          // colapsada accidentalmente.
          const hasActiveItem = section.items.some((i) =>
            isItemActive(i.href, pathname),
          );
          const isCollapsed = !hasActiveItem && collapsed[section.id] === true;
          const SectionIcon = section.icon;
          return (
            <div key={section.id} className="flex flex-col">
              <button
                type="button"
                onClick={() => toggleSection(section.id)}
                aria-expanded={!isCollapsed}
                aria-controls={`sidebar-section-${section.id}`}
                className={cn(
                  'group flex items-center gap-2 w-full px-2 h-7',
                  'text-[10px] uppercase tracking-[0.14em] font-medium',
                  'text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-muted)]',
                  'transition-colors duration-150',
                )}
                title={isCollapsed ? 'Mostrar sección' : 'Ocultar sección'}
              >
                <ChevronRight
                  className={cn(
                    'size-3 shrink-0 transition-transform duration-150',
                    !isCollapsed && 'rotate-90',
                  )}
                />
                <SectionIcon className="size-3 shrink-0 opacity-70 group-hover:opacity-100" />
                <span className="flex-1 text-left truncate">
                  {section.title}
                </span>
              </button>
              {!isCollapsed && (
                <div
                  id={`sidebar-section-${section.id}`}
                  className="flex flex-col gap-0.5 mt-0.5"
                >
                  {section.items.map((item) => {
                    const active = isItemActive(item.href, pathname);
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
              )}
            </div>
          );
        })}
      </nav>

      {/* User chip + logout — al final del flex column, scrollea con el aside. */}
      <div className="border-t border-[var(--color-border)] p-3 flex items-center gap-2 shrink-0 bg-[var(--color-bg)]">
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
