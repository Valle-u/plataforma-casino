/**
 * Header del admin — barra superior con:
 *   - Breadcrumb del pathname actual.
 *   - Search bar global (placeholder por ahora).
 *   - Indicador de "live" (dot pulsante rojo).
 *   - Bell de notifs (placeholder count).
 */

'use client';

import { Bell, Command, KeyRound, Vault } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ChangeMyPasswordModal } from '@/components/admin/change-my-password-modal';
import { MobileNavTrigger } from '@/components/admin/mobile-nav';
import { cn } from '@/lib/cn';
import { isAdminTenant, useAuth } from '@/lib/auth-context';
import { useHouseState } from '@/lib/hooks/use-house';
import { useMyWallet } from '@/lib/hooks/use-wallet';

export function Header() {
  const pathname = usePathname();
  const [changePwdOpen, setChangePwdOpen] = useState(false);
  const [showBalance, setShowBalance] = useState(true);
  const { user } = useAuth();
  const isAdmin = isAdminTenant(user);
  const houseQuery = useHouseState();
  const walletQuery = useMyWallet();
  const balance = isAdmin ? houseQuery.data?.balance : walletQuery.data?.balance;
  const loading = isAdmin ? houseQuery.isLoading : walletQuery.isLoading;

  const crumbs = useMemo(() => {
    const parts = pathname.split('/').filter(Boolean);
    return parts.map((part, i) => ({
      label: part.charAt(0).toUpperCase() + part.slice(1),
      href: '/' + parts.slice(0, i + 1).join('/'),
      isLast: i === parts.length - 1,
    }));
  }, [pathname]);

  return (
    // Sprint 51.9: sticky top-0 → se queda fijo cuando scrollea el main.
    // z-20 para quedar sobre dropdowns/tooltips de la página (sticky
    // de tabla = z-10), pero debajo de modales (z-50).
    // Sprint 55.x: en iOS standalone (PWA) el header queda debajo del
    // notch — h con safe-area-inset-top para empujar el contenido.
    <header className="h-[calc(3.5rem+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)] shrink-0 border-b border-[var(--color-border)] bg-[var(--color-bg)] flex items-center gap-3 sm:gap-4 px-4 sm:px-6 sticky top-0 z-20">
      {/* Sprint 53.2: burger menu — visible solo en mobile/tablet (< lg)
        * porque desktop usa el sidebar fijo de izquierda. */}
      <MobileNavTrigger />

      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-[12px] flex-1 min-w-0">
        <span className="text-[var(--color-fg-subtle)] font-mono">/</span>
        {crumbs.map((crumb, i) => (
          <div key={crumb.href} className="flex items-center gap-1.5 min-w-0">
            <span
              className={cn(
                'truncate tracking-tight',
                crumb.isLast
                  ? 'text-[var(--color-fg)]'
                  : 'text-[var(--color-fg-muted)]',
              )}
            >
              {crumb.label}
            </span>
            {i < crumbs.length - 1 && (
              <span className="text-[var(--color-fg-subtle)] font-mono">/</span>
            )}
          </div>
        ))}
      </nav>

      {/* Balance chip — mobile only */}
      <button
        type="button"
        onClick={() => setShowBalance((v) => !v)}
        className="lg:hidden flex items-center gap-1.5 h-7 px-2 text-[11px] font-mono tabular-nums text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg-subtle)] rounded transition-colors"
        title={showBalance ? 'Ocultar saldo' : 'Mostrar saldo'}
      >
        <Vault className="size-3 shrink-0 text-[var(--color-accent-text)]" />
        {showBalance ? (
          loading ? (
            <span className="opacity-50">…</span>
          ) : (
            <span>{balance ? Number(balance).toLocaleString('es-AR', { maximumFractionDigits: 0 }) : '—'}</span>
          )
        ) : (
          <span className="tracking-[0.2em]">••••</span>
        )}
      </button>

      {/* Search (placeholder) */}
      <button
        type="button"
        className={cn(
          'hidden md:flex items-center gap-2 px-2.5 h-8 text-[12px] rounded-[var(--radius-sm)]',
          'bg-[var(--color-bg-subtle)] border border-[var(--color-border)]',
          'text-[var(--color-fg-subtle)]',
          'hover:border-[var(--color-border-strong)] hover:text-[var(--color-fg-muted)]',
          'transition-colors duration-150',
        )}
      >
        <Command className="size-3" />
        <span>Buscar</span>
        <kbd className="ml-4 text-[10px] font-mono text-[var(--color-fg-subtle)] border border-[var(--color-border)] rounded px-1 py-px">
          ⌘K
        </kbd>
      </button>

      {/* Live indicator */}
      <div
        className="hidden sm:flex items-center gap-1.5 text-[11px] text-[var(--color-fg-muted)] uppercase tracking-[0.12em]"
        aria-label="Conexión en vivo"
      >
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-accent)] opacity-75" />
          <span className="relative inline-flex size-1.5 rounded-full bg-[var(--color-accent)]" />
        </span>
        Live
      </div>

      {/* Sprint 51.5: cambiar mi password */}
      <button
        type="button"
        aria-label="Cambiar mi password"
        title="Cambiar mi password"
        onClick={() => setChangePwdOpen(true)}
        className="size-9 rounded-[var(--radius-sm)] flex items-center justify-center text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg-subtle)] transition-colors"
      >
        <KeyRound className="size-4" />
      </button>

      {/* Bell */}
      <button
        type="button"
        aria-label="Notificaciones"
        className="relative size-9 rounded-[var(--radius-sm)] flex items-center justify-center text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg-subtle)] transition-colors"
      >
        <Bell className="size-4" />
        {/* Badge placeholder */}
        <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-[var(--color-accent)]" />
      </button>

      <ChangeMyPasswordModal open={changePwdOpen} onOpenChange={setChangePwdOpen} />
    </header>
  );
}
