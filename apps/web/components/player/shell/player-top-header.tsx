'use client';

/**
 * PlayerTopHeader — header superior del shell del jugador.
 *
 * Guest mode: shows logo + "Iniciar sesión" / "Registrarse" buttons.
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
  const { user } = useAuth();
  const wallet = useMyWallet();
  const pathname = usePathname();

  // ── Guest mode ──
  if (!user) {
    return (
      <header className="sticky top-0 z-20 flex h-16 w-full items-center gap-4 border-b border-[var(--color-border)] bg-[var(--color-bg)]/80 px-6 backdrop-blur">
        <div className="flex-1" />
        <div className="flex items-center gap-3">
          <Link
            href="/play/login"
            className="inline-flex h-9 items-center gap-2 rounded-[var(--radius)] border border-[var(--color-border)] px-4 text-[13px] font-medium text-[var(--color-fg)] transition-colors hover:border-[var(--color-accent-border)] hover:text-[var(--color-fg)]"
          >
            <LogIn className="size-4" />
            Iniciar sesión
          </Link>
          <Link
            href="/play/register"
            className="inline-flex h-9 items-center gap-2 rounded-[var(--radius)] px-4 text-[13px] font-semibold text-[var(--color-accent-fg)]"
            style={{ background: 'var(--gradient-accent)' }}
          >
            <UserPlus className="size-4" />
            Registrarse
          </Link>
        </div>
      </header>
    );
  }

  // ── Authenticated mode ──
  const balanceLabel =
    wallet.data?.balance == null
      ? '— fichas'
      : `$ ${arsFmt.format(Number(wallet.data.balance))} fichas`;

  return (
    <header className="sticky top-0 z-20 flex h-16 w-full items-center gap-4 border-b border-[var(--color-border)] bg-[var(--color-bg)]/80 px-6 backdrop-blur">
      {/* BUSCADOR */}
      <label className="flex h-9 min-w-0 max-w-[420px] flex-1 items-center gap-2 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 transition-colors duration-200 focus-within:border-[var(--color-accent-border)]">
        <Search
          size={16}
          className="shrink-0 text-[var(--color-fg-subtle)]"
          aria-hidden="true"
        />
        <input
          type="search"
          placeholder="Buscar juegos, proveedores…"
          aria-label="Buscar juegos, proveedores"
          className="min-w-0 flex-1 bg-transparent text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] focus:outline-none"
        />
      </label>

      {/* SPACER */}
      <div className="flex-1" />

      {/* CHIP DE SALDO */}
      <div className="flex h-9 items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3">
        <span
          className="animate-tg-live size-[7px] shrink-0 rounded-full bg-[var(--color-cyan)]"
          aria-hidden="true"
        />
        <span className="text-sm font-medium tabular-nums text-[var(--color-fg)]">
          {balanceLabel}
        </span>
      </div>

      {/* CTA "Depositar" */}
      <Link
        href="/play/deposits?new=1"
        className="animate-tg-glow inline-flex h-9 items-center gap-2 rounded-[var(--radius)] px-4 text-[13px] font-semibold text-[var(--color-accent-fg)]"
        style={{ background: 'var(--gradient-accent)' }}
      >
        <ArrowDownToLine size={16} aria-hidden="true" />
        Depositar
      </Link>

      {/* NOTIFICACIONES */}
      <NotificationsDropdown active={pathname === '/play/notifications'} pathname={pathname} />

      {/* USER MENU */}
      <UserMenu />
    </header>
  );
}
