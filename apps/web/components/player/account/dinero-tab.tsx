'use client';

/**
 * Tab "Mi dinero" de /play/account (docs/21-plan-perfil-wallet.md).
 *
 * Tarjetas de saldo (Disponible · Bono · En hold · estado) + CTAs que llevan
 * a las páginas existentes de depósito y retiro. No toca la wallet (solo
 * lectura vía useMyWallet).
 */

import Link from 'next/link';
import { CreditCard, Landmark } from 'lucide-react';
import { useMyWallet } from '@/lib/hooks/use-wallet';
import { BalanceCard, WalletStatusCard } from './balance-cards';

export function DineroTab() {
  const wallet = useMyWallet();

  return (
    <div className="flex flex-col gap-6">
      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        <BalanceCard
          label="Disponible"
          value={wallet.data?.balance}
          loading={wallet.isLoading}
          hint="Listo para jugar o retirar."
          accent="var(--color-accent)"
          highlight
        />
        <BalanceCard
          label="Bono"
          value={wallet.data?.bonusBalance}
          loading={wallet.isLoading}
          hint="Se usa antes que el balance real."
          accent="var(--color-gold)"
        />
        <BalanceCard
          label="En hold"
          value={wallet.data?.lockedBalance}
          loading={wallet.isLoading}
          hint="Retiros pendientes"
          accent="var(--color-gold)"
        />
        <WalletStatusCard
          walletId={wallet.data?.id}
          version={wallet.data?.version}
          loading={wallet.isLoading}
        />
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/play/deposits?new=1"
          className="inline-flex h-11 items-center gap-2 rounded-[var(--radius)] px-5 text-[13px] font-semibold text-[var(--color-accent-fg)] transition-opacity hover:opacity-90"
          style={{ background: 'var(--gradient-accent)' }}
        >
          <CreditCard className="size-4" />
          Cargar fichas
        </Link>
        <Link
          href="/play/withdrawals?new=1"
          className="inline-flex h-11 items-center gap-2 rounded-[var(--radius)] border border-[var(--color-border)] px-5 text-[13px] font-medium text-[var(--color-fg)] transition-colors hover:border-[var(--color-accent-border)] hover:text-[var(--color-fg)]"
        >
          <Landmark className="size-4" />
          Retirar
        </Link>
      </div>

      <p className="text-[11px] text-[var(--color-fg-subtle)]">
        Los movimientos completos de tu cuenta están en la pestaña{' '}
        <span className="text-[var(--color-fg-muted)]">Movimientos</span>.
      </p>
    </div>
  );
}
