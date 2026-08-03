'use client';

/**
 * PlayerTopHeader — header superior del shell del jugador.
 *
 * Guest mode: shows logo + "Iniciar sesión" / "Registrarse" buttons (open modals).
 * Auth mode: shows search, balance chip, deposit CTA, notifications, user menu.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowDownToLine, LogIn, UserPlus, Search } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useMyWallet } from '@/lib/hooks/use-wallet';
import { UserMenu } from './user-menu';
import { NotificationsDropdown } from '@/components/player/notifications-dropdown';

const arsFmt = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function PlayerTopHeader() {
  const { user, openLoginModal, openRegisterModal } = useAuth();
  const wallet = useMyWallet();
  const pathname = usePathname();

  // ── Guest mode ──
  if (!user) {
    return (
      <header className="sticky top-0 z-20 flex h-16 w-full items-center gap-4 border-b border-[var(--color-border)] bg-[var(--color-bg)]/80 px-6 backdrop-blur">
        <div className="flex-1" />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => openLoginModal()}
            className="inline-flex h-9 items-center gap-2 rounded-[var(--radius)] border border-[var(--color-border)] px-4 text-[13px] font-medium text-[var(--color-fg)] transition-colors hover:border-[var(--color-accent-border)] hover:text-[var(--color-fg)]"
          >
            <LogIn className="size-4" />
            Iniciar sesión
          </button>
          <button
            type="button"
            onClick={() => openRegisterModal()}
            className="inline-flex h-9 items-center gap-2 rounded-[var(--radius)] px-4 text-[13px] font-semibold text-[var(--color-accent-fg)]"
            style={{ background: 'var(--gradient-accent)' }}
          >
            <UserPlus className="size-4" />
            Registrarse
          </button>
        </div>
      </header>
    );
  }

  // ── Authenticated mode ──
  // Saldo disponible = balance − locked (retiros pendientes en hold no son
  // jugables — LEYES E6). El total se ve en la wallet page.
  const balanceLabel =
    wallet.data?.balance == null
      ? '—'
      : `$ ${arsFmt.format(
          Math.max(0, Number(wallet.data.balance) - Number(wallet.data.lockedBalance ?? '0')),
        )}`;
  const bonusBalanceLabel =
    wallet.data?.bonusBalance == null
      ? '—'
      : `$ ${arsFmt.format(Number(wallet.data.bonusBalance))}`;

  return (
    <header className="sticky top-0 z-20 flex h-16 w-full items-center gap-4 border-b border-[var(--color-border)] bg-[var(--color-bg)]/80 px-6 backdrop-blur">
      <label className="flex h-9 min-w-0 max-w-[420px] flex-1 items-center gap-2 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 transition-colors duration-200 focus-within:border-[var(--color-accent-border)]">
        <Search size={16} className="shrink-0 text-[var(--color-fg-subtle)]" aria-hidden="true" />
        <input type="search" placeholder="Buscar juegos, proveedores…" aria-label="Buscar juegos, proveedores" className="min-w-0 flex-1 bg-transparent text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] focus:outline-none" />
      </label>
      <div className="flex-1" />
      <div className="flex items-center gap-2">
        {/* Saldo disponible (plata real) */}
        <div className="flex h-9 items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3">
          <span className="animate-tg-live size-[7px] shrink-0 rounded-full bg-[var(--color-cyan)]" aria-hidden="true" />
          <span className="text-sm font-medium tabular-nums text-[var(--color-fg)]">{balanceLabel}</span>
        </div>
        {/* Saldo de bono */}
        <div className="flex h-9 items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3" title="Bono jugable (se usa antes que el saldo disponible)">
          <span className="size-2 shrink-0 rounded-full bg-[var(--color-accent)] opacity-60" aria-hidden="true" />
          <span className="text-[11px] font-medium text-[var(--color-fg-muted)]">Bono</span>
          <span className="text-sm font-medium tabular-nums text-[var(--color-accent-text)]">{bonusBalanceLabel}</span>
        </div>
      </div>
      <Link href="/play/deposits?new=1" className="animate-tg-glow inline-flex h-9 items-center gap-2 rounded-[var(--radius)] px-4 text-[13px] font-semibold text-[var(--color-accent-fg)]" style={{ background: 'var(--gradient-accent)' }}>
        <ArrowDownToLine size={16} aria-hidden="true" />
        Depositar
      </Link>
      <NotificationsDropdown active={pathname === '/play/notifications'} pathname={pathname} />
      <UserMenu />
    </header>
  );
}
