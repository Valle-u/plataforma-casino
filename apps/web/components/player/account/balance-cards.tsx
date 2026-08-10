'use client';

/**
 * Tarjetas de saldo del jugador — extraídas de app/play/wallet/page.tsx
 * para el tab "Mi dinero" de /play/account (docs/21-plan-perfil-wallet.md).
 *
 * BalanceCard: tarjeta con balance (animado en la principal) + hint.
 * WalletStatusCard: estado del wallet (verificado) + id/versión.
 */

import { useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useAnimatedNumber } from '@/lib/hooks/use-animated-number';

export function BalanceCard({
  label,
  value,
  loading,
  hint,
  accent,
  highlight,
}: {
  label: string;
  value: string | undefined;
  loading: boolean;
  hint: string;
  accent: string;
  highlight?: boolean;
}) {
  const numeric = value ? Number(value) : 0;
  const animated = useAnimatedNumber(numeric, 1100);

  // Burst dorado cuando el saldo principal sube.
  const prevRef = useRef<number | null>(null);
  const [burstKey, setBurstKey] = useState(0);
  useEffect(() => {
    if (!highlight || loading || value == null) return;
    if (prevRef.current === null) {
      prevRef.current = numeric;
      return;
    }
    if (numeric > prevRef.current) setBurstKey((k) => k + 1);
    prevRef.current = numeric;
  }, [numeric, value, loading, highlight]);

  const displayed = highlight ? animated : numeric;

  return (
    <div
      className="relative overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-5"
      style={{
        backgroundImage: `radial-gradient(120% 80% at 100% 0%, color-mix(in srgb, ${accent} 14%, transparent) 0%, transparent 60%)`,
      }}
    >
      {highlight && burstKey > 0 && (
        <span
          key={burstKey}
          aria-hidden
          className="pointer-events-none absolute inset-0 animate-balance-burst"
        />
      )}
      <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
        {label}
      </span>
      <div className="mt-2 flex items-baseline gap-2">
        <span
          className="font-display tabular-nums leading-none"
          style={{
            fontSize: highlight ? '2.5rem' : '1.75rem',
            color: highlight ? 'var(--color-fg)' : accent,
          }}
        >
          {loading
            ? '—'
            : displayed.toLocaleString('es-AR', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
          Fichas
        </span>
      </div>
      <span className="mt-1.5 block text-[11px] text-[var(--color-fg-subtle)]">
        {hint}
      </span>
    </div>
  );
}

export function WalletStatusCard({
  walletId,
  version,
  loading,
}: {
  walletId: string | undefined;
  version: number | undefined;
  loading: boolean;
}) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-5">
      <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
        Wallet
      </span>
      <div className="mt-2 flex items-center gap-1.5">
        <ShieldCheck className="size-4 text-[var(--color-success)]" />
        <span className="text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--color-success)]">
          Verificado
        </span>
      </div>
      <div className="mt-2 flex flex-col gap-1 font-mono text-[10px] text-[var(--color-fg-subtle)]">
        <span className="truncate">
          id: {loading ? '—' : `${walletId?.slice(0, 13)}…`}
        </span>
        <span>versión: {loading || version === undefined ? '—' : version}</span>
      </div>
    </div>
  );
}
