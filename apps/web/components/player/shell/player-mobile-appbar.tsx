'use client';

import Link from 'next/link';
import { Bell, LogIn, Menu, UserPlus } from 'lucide-react';
import { BrandWordmark } from '@/components/brand/brand-wordmark';
import { UserMenu } from '@/components/player/shell/user-menu';
import { useAuth } from '@/lib/auth-context';
import { useMyWallet } from '@/lib/hooks/use-wallet';
import { useTenantInfo } from '@/lib/hooks/use-tenant-branding';

const arsFmt = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

interface PlayerMobileAppBarProps {
  onOpenSidebar?: () => void;
}

export function PlayerMobileAppBar({ onOpenSidebar }: PlayerMobileAppBarProps) {
  const { user, openLoginModal, openRegisterModal } = useAuth();
  const wallet = useMyWallet();
  const tenantInfo = useTenantInfo();
  const branding = tenantInfo.data?.branding;
  const designBrand = tenantInfo.data?.design?.brand as { logoUrl?: string } | undefined;
  const logoUrl = branding?.logoUrl || designBrand?.logoUrl;

  const hamburger = (
    <button
      type="button"
      onClick={onOpenSidebar}
      className="grid size-9 shrink-0 place-items-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)]"
      aria-label="Abrir menú"
    >
      <Menu className="size-4" />
    </button>
  );

  // ── Guest mode ──
  if (!user) {
    return (
      <header className="sticky top-0 z-20 flex h-14 w-full items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg)]/85 px-4 backdrop-blur overflow-hidden">
        <div className="flex items-center gap-2 min-w-0">
          {hamburger}
          <Link href="/play" className="min-w-0">
            {/* Solo logo (sin nombre): el nombre bajo el logo desborda el header. */}
            <BrandWordmark size="sm" showCasino={false} src={logoUrl} />
          </Link>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => openLoginModal()}
            aria-label="Iniciar sesión"
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius)] border border-[var(--color-border)] px-3 text-[12px] font-medium text-[var(--color-fg)]"
          >
            <LogIn className="size-3.5" />
            <span className="hidden min-[420px]:inline">Entrar</span>
          </button>
          <button
            type="button"
            onClick={() => openRegisterModal()}
            aria-label="Registrarse"
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius)] bg-[var(--color-accent)] px-3 text-[12px] font-semibold text-[var(--color-accent-fg)]"
          >
            <UserPlus className="size-3.5" />
            <span className="hidden min-[420px]:inline">Registrarse</span>
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
    <header className="sticky top-0 z-20 border-b border-[var(--color-border)] bg-[var(--color-bg)]/85 backdrop-blur">
      {/* Fila 1: menú + logo + campana + avatar (UserMenu de escritorio) */}
      <div className="flex h-14 w-full items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-2 min-w-0">
          {hamburger}
          <Link href="/play" className="min-w-0">
            {/* Solo logo (sin nombre): el nombre bajo el logo desborda el header. */}
            <BrandWordmark size="sm" showCasino={false} src={logoUrl} />
          </Link>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href="/play/notifications"
            aria-label="Notificaciones"
            className="relative grid size-9 place-items-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)]"
          >
            <Bell className="size-4" />
            <span className="absolute -right-0.5 -top-0.5 grid size-4 place-items-center rounded-full bg-[var(--color-magenta)] text-[9px] font-bold leading-none text-[var(--color-bg)]">3</span>
          </Link>
          <UserMenu />
        </div>
      </div>

      {/* Fila 2: saldos siempre visibles (dinero real + bono) */}
      <div className="flex h-10 items-center gap-2 overflow-x-auto border-t border-[var(--color-border)]/60 bg-[var(--color-bg)]/40 px-4">
        <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2.5 py-1">
          <span className="size-1.5 rounded-full bg-[var(--color-cyan)] animate-tg-live" />
          <span className="text-[9px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
            Disponible
          </span>
          <span className="text-[12px] tabular-nums text-[var(--color-fg)]">{balanceLabel}</span>
        </div>
        <div
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2.5 py-1"
          title="Bono jugable (se usa antes que el saldo disponible)"
        >
          <span className="size-1.5 rounded-full bg-[var(--color-accent)] opacity-60" />
          <span className="text-[9px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
            Bono
          </span>
          <span className="text-[12px] tabular-nums text-[var(--color-accent-text)]">{bonusBalanceLabel}</span>
        </div>
      </div>
    </header>
  );
}
