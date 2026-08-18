/**
 * MobileNav — Sprint 53.2.
 *
 * En desktop (>= lg) la nav vive en el `<Sidebar>` fijo (hidden lg:flex).
 * En mobile/tablet (< lg) el sidebar está oculto y este componente
 * provee:
 *   - Burger button visible en el Header (vía export `MobileNavTrigger`).
 *   - Drawer overlay full-height con la misma estructura de navegación
 *     que el sidebar — secciones colapsables + user chip + logout.
 *
 * Comportamiento:
 *   - Click backdrop, ESC, o click en un Link cierra el drawer.
 *   - Scroll lock en body mientras está abierto (evita doble scroll).
 *
 * Reusa la misma fuente de verdad `SECTIONS` del sidebar para que un
 * cambio de nav se propague a ambos sin duplicar. Por eso exportamos
 * `SECTIONS` desde sidebar.tsx y lo consumimos acá.
 */

'use client';

import { ChevronRight, LogOut, Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { BrandWordmark } from '@/components/brand/brand-wordmark';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';
import { useTenantInfo } from '@/lib/hooks/use-tenant-branding';
import { isItemActive, visibleSectionsFor } from '@/components/admin/sidebar';

const STORAGE_KEY = 'sidebar.collapsed.v1';

function loadCollapsed(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveCollapsed(state: Record<string, boolean>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

/**
 * Trigger button para el drawer — el Header lo monta visible solo en
 * mobile (< lg). Maneja state internal del drawer.
 */
export function MobileNavTrigger() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir navegación"
        className={cn(
          'lg:hidden size-11 flex items-center justify-center',
          'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]',
          'hover:bg-[var(--color-bg-subtle)] transition-colors',
          '-ml-2',
        )}
      >
        <Menu className="size-4" />
      </button>
      {open && <MobileNavDrawer onClose={() => setOpen(false)} />}
    </>
  );
}

function MobileNavDrawer({ onClose }: { onClose: () => void }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const tenantInfo = useTenantInfo();
  const branding = tenantInfo.data?.branding;
  const designBrand = tenantInfo.data?.design?.brand as { logoUrl?: string } | undefined;
  const logoUrl = branding?.logoUrl || designBrand?.logoUrl;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setCollapsed(loadCollapsed());
  }, []);

  // ESC + body scroll lock + cerrar al navegar.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Cerrar al cambiar de ruta — el effect mira pathname.
  // Store the initial pathname so we only close on ACTUAL navigation, not on
  // the re-render triggered by setCollapsed() in the first effect.
  const initialPathname = useRef(pathname);
  useEffect(() => {
    if (pathname !== initialPathname.current) {
      onClose();
    }
  }, [pathname]);

  const toggleSection = (id: string): void => {
    setCollapsed((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      saveCollapsed(next);
      return next;
    });
  };

  return (
    <div
      className="lg:hidden fixed inset-0 z-50 flex"
      role="dialog"
      aria-modal="true"
      aria-label="Menú de navegación"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Cerrar"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      {/* Drawer panel */}
      <aside
        className={cn(
          'relative flex flex-col w-[min(85vw,300px)] h-full',
          'border-r border-[var(--color-border-strong)]',
          'bg-[var(--sidebar-bg)] shadow-[8px_0_32px_-8px_rgba(0,0,0,0.6)]',
          'animate-mobilenav-slide-in',
        )}
      >
        {/* Header del drawer — pt safe-area para el notch en iOS standalone */}
        <div className="flex items-center justify-between h-[calc(3.5rem+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)] px-4 border-b border-[var(--color-border)] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex flex-col leading-tight">
              <BrandWordmark size="sm" showCasino={false} src={logoUrl} />
              <span className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
                Panel · Operador
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar navegación"
            className="size-10 flex items-center justify-center text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg-subtle)] transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Nav scrolleable */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 flex flex-col gap-2">
          {visibleSectionsFor(user).map((section) => {
            const hasActiveItem = section.items.some((i) =>
              isItemActive(i.href, pathname),
            );
            const isCollapsed =
              !hasActiveItem && collapsed[section.id] === true;
            const SectionIcon = section.icon;
            return (
              <div key={section.id} className="flex flex-col">
                <button
                  type="button"
                  onClick={() => toggleSection(section.id)}
                  aria-expanded={!isCollapsed}
                  className={cn(
                    'group flex items-center gap-2 w-full px-2 h-11 mt-1',
                    'text-[11px] uppercase tracking-[0.1em] font-bold',
                    'text-[var(--color-fg)] hover:text-[var(--color-fg)]',
                    'transition-colors',
                  )}
                >
                  <SectionIcon className="size-4 shrink-0 text-[var(--color-fg-muted)]" />
                  <span className="flex-1 text-left truncate">
                    {section.title}
                  </span>
                  <ChevronRight
                    className={cn(
                      'size-3.5 shrink-0 opacity-50 transition-transform',
                      !isCollapsed && 'rotate-90',
                    )}
                  />
                </button>
                {!isCollapsed && (
                  <div className="flex flex-col gap-0.5 mt-0.5">
                    {section.items.map((item) => {
                      const active = isItemActive(item.href, pathname);
                      const Icon = item.icon;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={cn(
                            'group relative flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-sm)]',
                            'text-[14px] transition-colors duration-150',
                            // Tap target generoso en mobile (44px aprox)
                            active
                              ? 'text-[var(--color-fg)] font-semibold bg-[#1c1c1c]'
                              : 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[#191919]',
                          )}
                        >
                          <Icon
                            className={cn(
                              'size-4 shrink-0',
                              active
                                ? 'text-[var(--color-accent-text)]'
                                : 'text-[var(--color-fg-subtle)]',
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

        {/* User chip + logout — sticky footer with shadow separator */}
        <div className="border-t border-[var(--color-border)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] flex items-center gap-3 shrink-0 bg-[var(--sidebar-bg)] shadow-[0_-4px_16px_-4px_rgba(0,0,0,0.3)]">
          <div className="size-10 rounded-full border border-[var(--color-border-strong)] flex items-center justify-center text-[13px] font-mono uppercase shrink-0 bg-[var(--color-bg-subtle)]">
            {(user?.displayName ?? user?.username ?? '?').slice(0, 2)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] text-[var(--color-fg)] truncate">
              {user?.displayName ?? user?.username ?? '—'}
            </div>
            <div className="text-[10px] text-[var(--color-fg-subtle)] font-mono truncate">
              @{user?.username ?? 'guest'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => logout()}
            className="size-10 flex items-center justify-center text-[var(--color-fg-subtle)] hover:text-[var(--color-accent-text)] hover:bg-[var(--color-bg-subtle)] transition-colors"
            aria-label="Cerrar sesión"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </aside>
    </div>
  );
}
