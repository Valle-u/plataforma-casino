'use client';

/**
 * PlayerMobileAppBar — barra superior mobile del jugador (rediseño lobby 4a).
 *
 * Una sola fila: menú + logo · billetera segmentada (saldo + depositar) · campana.
 * En el HOME (/play) es translúcida y flota sobre el banner a sangre; en el resto
 * es sólida. Guest: menú + logo · login/registro. El saldo sale de useMyWallet
 * (dato existente); cero back nuevo.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowDownToLine, Bell, LogIn, Menu, UserPlus } from 'lucide-react';
import { BrandWordmark } from '@/components/brand/brand-wordmark';
import { useAuth } from '@/lib/auth-context';
import { useMyWallet } from '@/lib/hooks/use-wallet';
import { useMyUnreadCount } from '@/lib/hooks/use-my-notifications';
import { useTenantInfo } from '@/lib/hooks/use-tenant-branding';
import { cn } from '@/lib/cn';

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
  const unread = useMyUnreadCount();
  const tenantInfo = useTenantInfo();
  const pathname = usePathname();
  const isHome = pathname === '/play';
  const branding = tenantInfo.data?.branding;
  const designBrand = tenantInfo.data?.design?.brand as { logoUrl?: string } | undefined;
  const logoUrl = branding?.logoUrl || designBrand?.logoUrl;

  const headerClass = cn(
    'sticky top-0 z-30 flex h-14 w-full items-center gap-2.5 px-4',
    isHome
      ? 'bg-transparent'
      : 'border-b border-[var(--color-border)] bg-[var(--color-bg)]/85 backdrop-blur',
  );

  const scrim = isHome ? (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10"
      style={{
        background:
          'linear-gradient(180deg, rgba(10,0,8,.6) 0%, rgba(10,0,8,.2) 60%, transparent 100%)',
      }}
    />
  ) : null;

  const hamburger = (
    <button
      type="button"
      onClick={onOpenSidebar}
      className="grid size-11 shrink-0 place-items-center rounded-full border border-white/15 bg-[rgba(10,0,8,.4)] text-[var(--color-fg-muted)] backdrop-blur-sm"
      aria-label="Abrir menú"
    >
      <Menu className="size-4" />
    </button>
  );

  // ── Guest mode ──
  if (!user) {
    return (
      <header className={headerClass}>
        {scrim}
        {hamburger}
        <Link href="/play" className="min-w-0">
          <BrandWordmark size="sm" showCasino={false} src={logoUrl} />
        </Link>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => openLoginModal()}
            aria-label="Iniciar sesión"
            className="inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-[var(--radius)] border border-white/15 px-3 text-[12px] font-medium text-[var(--color-fg)] backdrop-blur-sm"
          >
            <LogIn className="size-3.5" />
            <span className="hidden min-[420px]:inline">Entrar</span>
          </button>
          <button
            type="button"
            onClick={() => openRegisterModal()}
            aria-label="Registrarse"
            className="inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-[var(--radius)] px-3 text-[12px] font-semibold text-[var(--color-accent-fg)]"
            style={{ background: 'var(--gradient-accent)' }}
          >
            <UserPlus className="size-3.5" />
            <span className="hidden min-[420px]:inline">Registrarse</span>
          </button>
        </div>
      </header>
    );
  }

  // ── Authenticated mode ──
  // Saldo disponible = balance − locked (retiros en hold no son jugables, E6).
  const balanceLabel =
    wallet.data?.balance == null
      ? '—'
      : `$ ${arsFmt.format(
          Math.max(0, Number(wallet.data.balance) - Number(wallet.data.lockedBalance ?? '0')),
        )}`;
  const unreadCount = unread.data?.count ?? 0;

  return (
    <header className={headerClass}>
      {scrim}
      {hamburger}
      <Link href="/play" className="min-w-0">
        <BrandWordmark size="sm" showCasino={false} src={logoUrl} />
      </Link>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {/* Billetera segmentada: saldo + depositar pegados. */}
        <div className="flex h-11 items-center overflow-hidden rounded-[14px] border border-white/18 bg-[rgba(10,0,8,.55)] backdrop-blur-sm">
          <span className="flex items-center gap-1.5 pl-2.5 pr-2">
            <span className="size-1.5 shrink-0 rounded-full bg-[var(--color-accent)] animate-tg-live" />
            <span className="text-[13px] font-semibold tabular-nums text-[var(--color-fg)]">
              {balanceLabel}
            </span>
          </span>
          <Link
            href="/play/deposits?new=1"
            aria-label="Depositar"
            className="grid size-11 place-items-center text-[var(--color-accent-fg)]"
            style={{ background: 'var(--gradient-accent)' }}
          >
            <ArrowDownToLine className="size-4" />
          </Link>
        </div>

        {/* Campana con badge de no leídas. */}
        <Link
          href="/play/notifications"
          aria-label="Notificaciones"
          className="relative grid size-11 shrink-0 place-items-center rounded-full border border-white/15 bg-[rgba(10,0,8,.4)] text-[var(--color-fg-muted)] backdrop-blur-sm"
        >
          <Bell className="size-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-[var(--color-accent)] px-1 text-[9px] font-bold leading-none text-[var(--color-accent-fg)]">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Link>
      </div>
    </header>
  );
}
