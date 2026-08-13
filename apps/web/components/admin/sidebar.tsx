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
 * Sprint 51.9 + sticky footer: layout de 3 zonas.
 *   - El `<aside>` es `sticky top-0 h-screen` (alto fijo = viewport).
 *   - Brand (arriba) y user chip + logout (abajo) son `shrink-0` → quedan
 *     SIEMPRE visibles. Solo el `<nav>` del medio scrollea (overflow-y-auto),
 *     así el botón de cerrar sesión nunca se va de vista aunque la lista de
 *     secciones sea larga.
 *
 * Sprint 51.9: secciones colapsables con persistencia.
 *   - Estado por sección en `localStorage` con key `sidebar.collapsed.<id>`.
 *   - Default: todas abiertas. Click en header de sección → toggle.
 *   - Si el item activo está dentro de una sección colapsada, la
 *     forzamos abierta automáticamente.
 *
 * Ancho fijo 240px desktop. En mobile (< lg) se oculta y aparece el
 * MobileNavDrawer vía el burger en el Header.
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
  Layers,
  LayoutGrid,
  Landmark,
  Link2,
  LogOut,
  Network,
  Package,
  Scale,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  Store,
  Users,
  Vault,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ComponentType, type SVGProps } from 'react';
import { TangoWordmark } from '@/components/brand/tango-wordmark';
import {
  isAdminTenant,
  isIndependentBranch,
  useAuth,
  type TenantUser,
} from '@/lib/auth-context';
import { cn } from '@/lib/cn';
import { useHouseState } from '@/lib/hooks/use-house';
import { useMyWallet } from '@/lib/hooks/use-wallet';
import { useTenantInfo } from '@/lib/hooks/use-tenant-branding';

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /**
   * El item se muestra si el user tiene AL MENOS uno de estos permisos
   * efectivos (semántica OR — cubre los variantes view/view_any/view_all).
   * Sin `anyPerm` ni `visible` → siempre visible (landing / data propia).
   */
  anyPerm?: string[];
  /**
   * Predicado libre para casos que no mapean a un permiso (ej. rol). Tiene
   * precedencia sobre `anyPerm`. Es gating de UX; el backend igual valida
   * permisos en cada endpoint.
   */
  visible?: (user: TenantUser | null) => boolean;
}

/**
 * ¿Se le muestra `item` al `user`?
 *   - `visible` (predicado) tiene precedencia.
 *   - `anyPerm`: true si tiene alguno de esos permisos efectivos. OJO: si
 *     `effectivePermissions` viene `undefined` (sesión previa al fix que lo
 *     agregó a /me, o durante el bootstrap), NO gateamos (default-allow) para
 *     no colapsar el menú — el backend igual protege cada endpoint.
 *   - sin gate → visible.
 */
function isItemVisible(item: NavItem, user: TenantUser | null): boolean {
  if (item.visible) return item.visible(user);
  if (item.anyPerm && item.anyPerm.length > 0) {
    const eff = user?.effectivePermissions;
    if (eff === undefined) return true;
    return item.anyPerm.some((p) => eff.includes(p));
  }
  return true;
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
      // Landing — cualquier operador con acceso al panel.
      { href: '/dashboard', label: 'Dashboard', icon: Gauge },
      { href: '/users', label: 'Usuarios', icon: Users, anyPerm: ['users.view_any'] },
      // Wallet propia del operador (load/unload + saldo) — data propia.
      // Fase 4: para el admin_tenant la Casa ES su caja (ver /tesoreria);
      // su wallet personal está en 0 y esconderla evita confusión.
      {
        href: '/wallet',
        label: 'Wallet',
        icon: Wallet,
        visible: (u) => !u?.roles?.includes('admin_tenant'),
      },
      { href: '/deposits', label: 'Depósitos', icon: ArrowLeftRight, anyPerm: ['deposits.view', 'deposits.view_all'] },
      { href: '/withdrawals', label: 'Retiros', icon: Coins, anyPerm: ['withdrawals.view', 'withdrawals.view_all'] },
      { href: '/bank-transactions', label: 'Transferencias', icon: Landmark, anyPerm: ['bank_tx.view'] },
      { href: '/branches', label: 'Sucursales', icon: Store, anyPerm: ['branch.view'] },
      {
        href: '/my-branch',
        label: 'Mi sucursal',
        icon: Building2,
        // Self-view de la sucursal del socio (incl. los que aún no son
        // independientes — la página les explica cómo pedirlo). También
        // visible para cajeros/distribuidores de sucursales independientes
        // para que puedan gestionar métodos de pago (la página detecta
        // automáticamente si están bajo una sucursal independiente).
        visible: (u) => !!u?.roles?.some(r => ['socio', 'cajero', 'distribuidor'].includes(r)),
      },
    ],
  },
  {
    id: 'engagement',
    title: 'Engagement',
    icon: Sparkles,
    items: [
      { href: '/bonus-definitions', label: 'Plantillas de bono', icon: Package, anyPerm: ['bonuses.view', 'bonuses.view_any', 'bonuses.view_all'] },
      { href: '/referrals', label: 'Mis Referidos', icon: Link2, anyPerm: ['referrals.view_own', 'referrals.view_any'] },
      // Bonos, Promociones, Ligas deshabilitados temporalmente (fase simplificación MVP).
      // { href: '/bonuses', label: 'Bonos', icon: Gift, anyPerm: ['bonuses.view_any', 'bonuses.view_all'] },
      // { href: '/promotions', label: 'Promociones', icon: Sparkles, anyPerm: ['promotions.view', 'promotions.view_any'] },
      // { href: '/leagues', label: 'Ligas', icon: Trophy, anyPerm: ['leagues.view', 'leagues.view_any'] },
    ],
  },
  {
    id: 'trazabilidad',
    title: 'Trazabilidad y negocio',
    icon: BarChart3,
    items: [
      { href: '/ledger', label: 'Integridad del ledger', icon: Scale, anyPerm: ['ledger.view'] },
      { href: '/tesoreria', label: 'Tesorería', icon: Vault, anyPerm: ['house.view'] },
      { href: '/wallet-stats', label: 'Stats de pago', icon: FileBarChart2, anyPerm: ['wallet_stats.view_any', 'wallet_stats.view_own_network'] },
      { href: '/game-stats', label: 'Stats de juego', icon: Dices, anyPerm: ['game_stats.view_any', 'game_stats.view_own_network'] },
      { href: '/games', label: 'Game Providers', icon: Dices, visible: (u) => !!u?.roles?.includes('admin_tenant') },
      { href: '/fraud', label: 'Antifraude', icon: ShieldCheck, anyPerm: ['fraud.view', 'fraud.review', 'fraud.run_scan'] },
      { href: '/audit', label: 'Audit log', icon: FileText, anyPerm: ['audit.view', 'audit.export'] },
      { href: '/notifications', label: 'Notificaciones', icon: BellRing, anyPerm: ['notifications.view_any', 'notifications.export', 'notifications.retry'] },
    ],
  },
  {
    id: 'sistema',
    title: 'Sistema',
    icon: Server,
    items: [
      { href: '/red', label: 'Red', icon: Network, anyPerm: ['users.view_any'] },
      { href: '/permissions', label: 'Permisos', icon: Layers, anyPerm: ['permissions.grant', 'permissions.revoke'] },
      {
        href: '/payment-methods',
        label: 'Métodos de pago',
        icon: CreditCard,
        // Catálogo del tenant → SOLO admin. Se gatea por ROL (no por el permiso
        // payment_methods.edit) porque a algunos socios independientes se les
        // otorgó ese permiso por override, y no deben ver el catálogo. Sus
        // métodos propios los gestionan dentro de "Mi sucursal".
        visible: (u) => isAdminTenant(u),
      },
      { href: '/network-commissions', label: 'Comisiones por red', icon: Network, anyPerm: ['commissions.configure'] },
      { href: '/settings', label: 'Configuración', icon: Settings, anyPerm: ['tenant.settings.edit'] },
      { href: '/templates', label: 'Plantillas', icon: LayoutGrid, anyPerm: ['tenant.notifications.templates.edit'] },
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

/**
 * Filtra las secciones/items según la visibilidad para `user` y descarta las
 * secciones que quedan sin items. Fuente única de verdad del nav visible —
 * la usan el sidebar desktop y el MobileNav para no divergir.
 */
export function visibleSectionsFor(user: TenantUser | null): NavSection[] {
  return SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((i) => isItemVisible(i, user)),
  })).filter((section) => section.items.length > 0);
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
  const tenantInfo = useTenantInfo();
  const branding = tenantInfo.data?.branding;
  const designBrand = tenantInfo.data?.design?.brand as { platformName?: string; logoUrl?: string } | undefined;
  const logoUrl = branding?.logoUrl || designBrand?.logoUrl;
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
    <aside className="hidden lg:flex flex-col w-60 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-bg)] sticky top-0 h-screen">
      {/* Brand */}
      <Link
        href="/dashboard"
        className="flex items-center gap-3 px-4 h-14 shrink-0 border-b border-[var(--color-border)] hover:bg-[var(--color-bg-subtle)] transition-colors"
      >
        <div className="flex flex-col leading-tight">
          <TangoWordmark size="sm" showCasino={false} src={logoUrl} />
          <span className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
            Panel · Operador
          </span>
        </div>
      </Link>

      {/* Nav — UNA scrollbar única para todo el aside (no overflow propio
          acá; el aside es el contenedor scrollable). */}
      <nav className="flex-1 min-h-0 overflow-y-auto py-3 px-2 flex flex-col gap-2">
        {visibleSectionsFor(user).map((section) => {
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

      {/* Balance chip — muestra la caja del operador logueado:
        *   - admin_tenant → balance de la Casa (via useHouseState).
        *   - resto        → balance de su propia wallet.
        * El label cambia para hacer explícito qué caja es. */}
      <BalanceChip user={user} />

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

/**
 * Chip de balance en el footer del sidebar. Fase 4 · UX de "mi caja":
 *
 *   - admin_tenant → balance de la Casa (via `useHouseState`). Link a
 *     `/tesoreria`, label "Bankroll de la Casa".
 *   - socio indep  → balance de su wallet propia. Link a `/wallet`, label
 *     "Mi caja del casino" (porque ES su tesorería).
 *   - resto        → balance de su wallet propia. Link a `/wallet`, label
 *     "Mi balance" (data personal, no bankroll de un negocio).
 *
 * Colores: acento discreto para admin, neutral para el resto. Skeleton
 * mientras carga; oculto silenciosamente si falla la query (no rompe la nav).
 */
function BalanceChip({ user }: { user: TenantUser | null }) {
  const isAdmin = isAdminTenant(user);
  const isIndep = isIndependentBranch(user);
  const houseQuery = useHouseState();
  const walletQuery = useMyWallet();

  if (!user) return null;

  const balance = isAdmin
    ? houseQuery.data?.balance
    : walletQuery.data?.balance;
  const loading = isAdmin ? houseQuery.isLoading : walletQuery.isLoading;
  const errored = isAdmin ? houseQuery.isError : walletQuery.isError;

  // No mostrar chip si la query falla (ej: 404 HOUSE_NOT_PROVISIONED en
  // tenants viejos). El header sigue funcionando.
  if (errored) return null;

  const label = isAdmin
    ? 'Bankroll de la Casa'
    : isIndep
      ? 'Mi caja del casino'
      : 'Mi balance';
  const href = isAdmin ? '/tesoreria' : '/wallet';

  return (
    <Link
      href={href}
      className={cn(
        'border-t border-[var(--color-border)] px-3 py-2.5 flex items-center gap-2.5 shrink-0',
        'bg-[var(--color-bg)] hover:bg-[var(--color-bg-subtle)] transition-colors',
        'border-l-2',
        isAdmin ? 'border-l-[var(--color-accent)]' : 'border-l-transparent',
      )}
      title={isAdmin ? 'Ir a Tesorería · la Casa' : 'Ir a Wallet'}
    >
      <Vault
        className={cn(
          'size-3.5 shrink-0',
          isAdmin
            ? 'text-[var(--color-accent-text)]'
            : 'text-[var(--color-fg-subtle)]',
        )}
      />
      <div className="flex-1 min-w-0 leading-tight">
        <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
          {label}
        </div>
        <div
          className={cn(
            'text-[13px] font-mono tabular-nums truncate',
            isAdmin
              ? 'text-[var(--color-fg)]'
              : 'text-[var(--color-fg-muted)]',
          )}
        >
          {loading
            ? '…'
            : balance !== undefined
              ? formatChip(balance)
              : '—'}
        </div>
      </div>
    </Link>
  );
}

function formatChip(balance: string): string {
  // "1234567.89" → "1,234,567". Compacto: el sidebar no tiene mucho ancho.
  const [int] = balance.split('.');
  return (int ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
