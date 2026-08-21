/**
 * UserMenu — dropdown del avatar en el header del player.
 *
 * Al hacer click en el avatar (antes iba a /play/settings), ahora abre
 * un menú con:
 *   - Saldo disponible (retirable) + saldo de bono
 *   - Stats rápidas (total tx, net change 7d)
 *   - Botones: Depositar, Retirar
 *   - Links: Cambiar contraseña, Cerrar sesión
 *
 * Usa el mismo patrón que NotificationsDropdown (click-outside, ESC,
 * surface-glass, animate-dropdown-in).
 */

'use client';

import {
  ArrowDownToLine,
  ArrowUpFromLine,
  KeyRound,
  LogOut,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ChangeMyPasswordModal } from '@/components/admin/change-my-password-modal';
import { useAuth } from '@/lib/auth-context';
import { useMyWallet, useMyWalletStats } from '@/lib/hooks/use-wallet';
import { cn } from '@/lib/cn';

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

export function UserMenu() {
  const [open, setOpen] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { user, logout } = useAuth();
  const wallet = useMyWallet();
  const stats = useMyWalletStats(7);

  // Saldo disponible = balance − locked (retiros pendientes en hold no son
  // jugables — LEYES E6). El total se ve en la wallet page.
  const balance = wallet.data?.balance ?? '0';
  const lockedBalance = wallet.data?.lockedBalance ?? '0';
  const availableBalance = Math.max(
    0,
    Number(balance) - Number(lockedBalance),
  ).toFixed(2);
  const bonusBalance = wallet.data?.bonusBalance ?? '0';
  const totalTxs = stats.data?.totalTransactions ?? 0;
  const netChange = stats.data?.netChange ?? '0';
  const netNum = Number(netChange);
  const isNetPositive = netNum >= 0;

  const name = user?.displayName || user?.username || 'CL';
  const initials = getInitials(name);

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

  return (
    <>
    <div ref={ref} className="relative">
      {/* Avatar button */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Mi cuenta ${initials}`}
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-full',
          'border transition-colors duration-200',
          open
            ? 'border-[var(--color-accent)] bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)]'
            : 'border-[var(--color-border)] bg-[var(--color-bg-subtle)] text-[var(--color-accent-text)] hover:border-[var(--color-accent)]',
        )}
      >
        {initials}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          role="menu"
          className={cn(
            'absolute right-0 top-full mt-2 z-40',
            'w-[300px] max-w-[calc(100vw-2rem)]',
            'surface-glass rounded-[var(--radius-lg)] overflow-hidden',
            'animate-dropdown-in',
          )}
        >
          {/* Header: nombre + username */}
          <div className="px-4 pt-4 pb-3 border-b border-[var(--color-border)]">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-subtle)] flex items-center justify-center text-[13px] font-medium text-[var(--color-accent-text)]">
                {initials}
              </div>
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-[var(--color-fg)] truncate">
                  {user?.displayName || user?.username}
                </div>
                <div className="text-[11px] font-mono text-[var(--color-fg-muted)] truncate">
                  @{user?.username}
                </div>
              </div>
            </div>
          </div>

          {/* Balances */}
          <div className="px-4 py-3 border-b border-[var(--color-border)]">
            <div className="flex flex-col gap-2">
              {/* Saldo disponible */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Wallet className="size-3 text-[var(--color-accent-text)]" />
                  <span className="text-[11px] text-[var(--color-fg-muted)]">
                    Disponible
                  </span>
                </div>
                <span className="text-[13px] font-medium tabular-nums text-[var(--color-fg)]">
                  $ {arsFmt.format(Number(availableBalance))}
                </span>
              </div>
              {/* Saldo de bono */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="size-3 rounded-full bg-[var(--color-accent)] opacity-60" />
                  <span className="text-[11px] text-[var(--color-fg-muted)]">
                    Bono jugable
                  </span>
                </div>
                <span className="text-[13px] font-medium tabular-nums text-[var(--color-accent-text)]">
                  $ {arsFmt.format(Number(bonusBalance))}
                </span>
              </div>
            </div>
          </div>

          {/* Stats rápidas */}
          <div className="px-4 py-3 border-b border-[var(--color-border)]">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[var(--color-fg-muted)]">
                {totalTxs} txs · últimos 7d
              </span>
              <span
                className={cn(
                  'inline-flex items-center gap-0.5 font-medium tabular-nums',
                  isNetPositive
                    ? 'text-[var(--color-success)]'
                    : 'text-[var(--color-danger)]',
                )}
              >
                {isNetPositive ? (
                  <TrendingUp className="size-3" />
                ) : (
                  <TrendingDown className="size-3" />
                )}
                {isNetPositive ? '+' : ''}${arsFmt.format(Math.abs(netNum))}
              </span>
            </div>
          </div>

          {/* Acciones */}
          <div className="p-2 flex flex-col gap-1">
            <Link
              href="/play/deposits?new=1"
              onClick={() => setOpen(false)}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-[var(--radius)]',
                'text-[13px] text-[var(--color-fg)]',
                'hover:bg-[var(--color-bg-subtle)] transition-colors',
              )}
            >
              <ArrowDownToLine className="size-4 text-[var(--color-success)]" />
              Depositar
            </Link>
            <Link
              href="/play/withdrawals?new=1"
              onClick={() => setOpen(false)}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-[var(--radius)]',
                'text-[13px] text-[var(--color-fg)]',
                'hover:bg-[var(--color-bg-subtle)] transition-colors',
              )}
            >
              <ArrowUpFromLine className="size-4 text-[var(--color-warning)]" />
              Retirar
            </Link>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setPwdOpen(true);
              }}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-[var(--radius)] w-full text-left',
                'text-[13px] text-[var(--color-fg)]',
                'hover:bg-[var(--color-bg-subtle)] transition-colors',
              )}
            >
              <KeyRound className="size-4 text-[var(--color-fg-muted)]" />
              Cambiar contraseña
            </button>
          </div>

          {/* Logout */}
          <div className="px-2 pb-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                logout('/play/login');
              }}
              className={cn(
                'flex w-full items-center gap-2.5 px-3 py-2 rounded-[var(--radius)]',
                'text-[13px] text-[var(--color-danger)]',
                'hover:bg-[var(--color-danger-subtle)] transition-colors',
              )}
            >
              <LogOut className="size-4" />
              Cerrar sesión
            </button>
          </div>
        </div>
      )}
    </div>
    <ChangeMyPasswordModal open={pwdOpen} onOpenChange={setPwdOpen} />
    </>
  );
}
