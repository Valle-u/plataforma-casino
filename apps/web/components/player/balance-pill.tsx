/**
 * BalancePill — pill del balance en el header (Sprint 51.15 dopamine).
 *
 * Extraído de PlayerHeader para meterle interacciones:
 *
 *   - useAnimatedNumber: el número ramp-up con easeOutQuart (sensación
 *     "subiendo en vivo" cuando entra plata o cuando el balance cambia
 *     después de un win/deposit).
 *   - Burst dorado: cuando detectamos que el balance SUBIÓ vs el último
 *     valor estable, disparamos un ring dorado que pulsa una vez y se
 *     desvanece. Más una "etiqueta flotante" `+X chips` que sube fade-up.
 *   - Bounce: el pill mismo hace un micro-scale (1 → 1.04 → 1) en el
 *     mismo evento.
 *
 * No anima nada si:
 *   - El balance disminuyó (no queremos celebrar pérdidas/withdrawals
 *     con efectos felices — sería raro).
 *   - Es el primer mount (todavía no hay "anterior" real para comparar).
 *   - El delta es 0.
 *
 * Performance: las animaciones son CSS keyframes (transform + opacity),
 * todas GPU-aceleradas. El RAF loop del counter ya estaba.
 */

'use client';

import { Coins } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useAnimatedNumber } from '@/lib/hooks/use-animated-number';
import { cn } from '@/lib/cn';

export function BalancePill({
  balance,
  loading,
}: {
  balance: string | undefined;
  loading: boolean;
}) {
  const targetNum = balance ? Number(balance) : 0;
  const animated = useAnimatedNumber(targetNum, 900);

  // ── Detect increment para disparar burst ────────────────────────
  const prevStableRef = useRef<number | null>(null);
  const [burstKey, setBurstKey] = useState(0);
  const [burstDelta, setBurstDelta] = useState(0);

  useEffect(() => {
    if (loading || balance == null) return;
    const prev = prevStableRef.current;
    // Primer mount → guardar sin disparar burst.
    if (prev == null) {
      prevStableRef.current = targetNum;
      return;
    }
    if (targetNum > prev) {
      setBurstDelta(targetNum - prev);
      setBurstKey((k) => k + 1); // forzar restart de la animación
    }
    prevStableRef.current = targetNum;
  }, [targetNum, balance, loading]);

  const fullFormat =
    loading || !balance
      ? '— · — —'
      : Math.round(animated).toLocaleString('es-AR');
  const compact =
    loading || !balance ? '— —' : compactNumber(animated);
  const fullForTitle = balance ? Number(balance).toLocaleString('es-AR') : '—';

  return (
    <Link
      href="/play/wallet"
      className={cn(
        'relative group flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 h-9',
        'rounded-[var(--radius)] btn-premium-secondary',
      )}
      title={`Ir a tu wallet · ${fullForTitle} fichas`}
    >
      {/* Ring dorado de burst — un loop solo, key fuerza restart. */}
      {burstKey > 0 && (
        <span
          key={burstKey}
          aria-hidden
          className="absolute inset-0 pointer-events-none animate-balance-burst"
          style={{
            boxShadow: '0 0 0 0 rgba(255,215,0,0.55)',
          }}
        />
      )}
      {/* Floating "+X" label — sube y se desvanece */}
      {burstKey > 0 && burstDelta > 0 && (
        <span
          key={`label-${burstKey}`}
          aria-hidden
          className={cn(
            'absolute -top-3 right-1 pointer-events-none',
            'text-[10px] font-mono font-medium tabular-nums',
            'animate-balance-pop',
          )}
          style={{ color: '#FFD700' }}
        >
          +{compactNumber(burstDelta)}
        </span>
      )}

      <Coins
        className={cn(
          'size-3.5 text-[var(--color-accent-text)] transition-transform',
          burstKey > 0 && 'animate-balance-coin-spin',
        )}
      />
      <span className="text-[13px] font-mono tabular-nums text-[var(--color-fg)] sm:hidden">
        {compact}
      </span>
      <span className="hidden sm:inline text-[13px] font-mono tabular-nums text-[var(--color-fg)]">
        {fullFormat}
      </span>
      <span className="hidden sm:inline text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
        FICHAS
      </span>
    </Link>
  );
}

/** 1234 → "1.2K", 1234567 → "1.2M". Compacto para mobile / labels. */
function compactNumber(n: number): string {
  if (n < 1000) return Math.round(n).toString();
  if (n < 1_000_000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return (n / 1_000_000).toFixed(2).replace(/\.0+$/, '') + 'M';
}
