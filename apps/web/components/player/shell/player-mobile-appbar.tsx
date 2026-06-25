'use client';

import Link from 'next/link';
import { Bell } from 'lucide-react';
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

export function PlayerMobileAppBar() {
  const wallet = useMyWallet();
  const { user } = useAuth();

  const balanceLabel =
    wallet.data?.balance == null
      ? '— fichas'
      : `$ ${arsFmt.format(Number(wallet.data.balance))} fichas`;

  const name = user?.displayName || user?.username || 'CL';
  const initials = getInitials(name);

  return (
    <header className="sticky top-0 z-20 flex h-14 w-full items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg)]/85 px-4 backdrop-blur">
      <Link
        href="/play"
        className="text-[20px] font-bold tracking-[.05em] text-[var(--color-fg)]"
      >
        TA
        <span
          className="text-[var(--color-accent)]"
          style={{ textShadow: '0 0 16px rgba(46,155,255,.7)' }}
        >
          N
        </span>
        GO
      </Link>

      <div className="flex items-center gap-2">
        <div className="flex h-8 items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2.5">
          <span className="size-1.5 rounded-full bg-[var(--color-cyan)] animate-tg-live" />
          <span className="text-[12px] tabular-nums text-[var(--color-fg)]">
            {balanceLabel}
          </span>
        </div>

        <Link
          href="/play/notifications"
          aria-label="Notificaciones"
          className="relative grid size-9 place-items-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)]"
        >
          <Bell className="size-4" />
          <span className="absolute -right-0.5 -top-0.5 grid size-4 place-items-center rounded-full bg-[var(--color-magenta)] text-[9px] font-bold leading-none text-[var(--color-bg)]">
            3
          </span>
        </Link>

        <Link
          href="/play/settings"
          aria-label="Mi cuenta"
          className="grid size-9 place-items-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg-subtle)] text-[11px] font-bold text-[var(--color-cyan)]"
        >
          {initials}
        </Link>
      </div>
    </header>
  );
}
