'use client';

import Link from 'next/link';
import { Bell, LogIn, UserPlus } from 'lucide-react';
import { TangoWordmark } from '@/components/brand/tango-wordmark';
import { useAuth } from '@/lib/auth-context';
import { useMyWallet } from '@/lib/hooks/use-wallet';
import { useTenantInfo } from '@/lib/hooks/use-tenant-branding';

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
  const { user } = useAuth();
  const wallet = useMyWallet();
  const tenantInfo = useTenantInfo();
  const branding = tenantInfo.data?.branding;
  const designBrand = tenantInfo.data?.design?.brand as { platformName?: string; logoUrl?: string } | undefined;
  const logoUrl = branding?.logoUrl || designBrand?.logoUrl;
  const platformName = designBrand?.platformName || tenantInfo.data?.tenant?.name;

  // ── Guest mode ──
  if (!user) {
    return (
      <header className="sticky top-0 z-20 flex h-14 w-full items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg)]/85 px-4 backdrop-blur overflow-hidden">
        <Link href="/play">
          <TangoWordmark size="sm" showCasino={false} src={logoUrl} platformName={platformName} />
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href="/play/login"
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius)] border border-[var(--color-border)] px-3 text-[12px] font-medium text-[var(--color-fg)]"
          >
            <LogIn className="size-3.5" />
            Entrar
          </Link>
          <Link
            href="/play/register"
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius)] bg-[var(--color-accent)] px-3 text-[12px] font-semibold text-[var(--color-accent-fg)]"
          >
            <UserPlus className="size-3.5" />
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

  const name = user?.displayName || user?.username || 'CL';
  const initials = getInitials(name);

  return (
    <header className="sticky top-0 z-20 flex h-14 w-full items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg)]/85 px-4 backdrop-blur overflow-hidden">
      <Link href="/play">
        <TangoWordmark size="sm" showCasino={false} src={logoUrl} platformName={platformName} />
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
