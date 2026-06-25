'use client';

/**
 * PlayerTopHeader — header superior del shell del jugador (rediseño
 * "Neón Milonga"). Fila horizontal sticky con buscador, chip de saldo,
 * CTA de depósito, campana de notificaciones y avatar. Self-contained:
 * lee saldo (useMyWallet) y usuario (useAuth) internamente, no recibe props.
 */

import Link from 'next/link';
import { Search, ArrowDownToLine, Bell } from 'lucide-react';
import { useMyWallet } from '@/lib/hooks/use-wallet';
import { useAuth } from '@/lib/auth-context';

const arsFmt = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
  }
  return name.trim().slice(0, 2).toUpperCase();
}

export function PlayerTopHeader() {
  const wallet = useMyWallet();
  const { user } = useAuth();

  const balanceLabel =
    wallet.data?.balance == null
      ? '— fichas'
      : `$ ${arsFmt.format(Number(wallet.data.balance))} fichas`;

  const initials = getInitials(user?.displayName || user?.username || 'CL');

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
        href="/play/deposits"
        className="animate-tg-glow inline-flex h-9 items-center gap-2 rounded-[var(--radius)] px-4 text-[13px] font-semibold text-[var(--color-accent-fg)]"
        style={{ background: 'var(--gradient-accent)' }}
      >
        <ArrowDownToLine size={16} aria-hidden="true" />
        Depositar
      </Link>

      {/* CAMPANA */}
      <Link
        href="/play/notifications"
        aria-label="Notificaciones"
        className="relative flex size-9 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] transition-colors duration-200 hover:text-[var(--color-fg)]"
      >
        <Bell size={16} aria-hidden="true" />
        <span
          className="absolute -right-1 -top-1 flex min-w-[16px] items-center justify-center rounded-full bg-[var(--color-magenta)] px-1 text-[9px] font-semibold leading-[16px] text-[var(--color-fg)]"
          aria-hidden="true"
        >
          3
        </span>
      </Link>

      {/* AVATAR */}
      <Link
        href="/play/settings"
        aria-label={`Mi cuenta ${initials}`}
        className="flex size-9 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg-subtle)] text-[12px] font-medium text-[var(--color-accent-text)]"
      >
        {initials}
      </Link>
    </header>
  );
}
