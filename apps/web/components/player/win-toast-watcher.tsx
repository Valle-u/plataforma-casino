/**
 * WinToastWatcher — Sprint 51.17.
 *
 * Componente "headless+UI" montado en el layout `/play/*`. Observa el
 * balance del player via `useMyWallet` (que ya tiene polling 20s + refetch
 * on focus desde 51.16) y cuando detecta un INCREMENTO disparara:
 *
 *   1. Un toast top-right (top-center en mobile) con la celebración:
 *      "🎉 +1.234 chips" + razón si la deducimos.
 *   2. Confetti side (suave, no jackpot — no queremos saturar visualmente
 *      cada deposit chico). Si el delta es grande (>= JACKPOT_THRESHOLD)
 *      usamos confettiJackpot que es más intenso.
 *   3. Haptic via el wrapper de confetti.
 *
 * Lógica de detección:
 *   - Trackeamos el balance previo en useRef. El primer mount NO dispara
 *     toast (no sabemos cuál era el "antes" real — sería falso positivo
 *     en el initial load).
 *   - Sólo subidas (delta > 0). Bajadas (bet placed, withdrawal) no
 *     celebramos — sería raro.
 *   - Threshold mínimo (MIN_DELTA): evita celebrar floats por rounding
 *     o micro-créditos.
 *
 * Inferencia del motivo (best-effort, mejora la copy del toast):
 *   - Comparamos contra la última tx en useMyTransactions. Si la última
 *     tx es del tipo crédito y matchea el delta, usamos su `type` para
 *     la copy. Si no, fallback genérico "Ganancia".
 *
 * Stack de toasts: array en estado local, auto-dismiss 4.5s c/u, cap a
 * 3 simultáneos (el cap evita pantallazos si un cajero hace 5 cargas
 * seguidas — el último gana el "primer plano").
 *
 * Reduced motion: si el usuario lo pidió, sin confetti (sólo toast).
 */

'use client';

import { Coins, Gift, PartyPopper, Sparkles, TrendingUp, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { confettiJackpot, confettiSide } from '@/lib/confetti';
import { useMyTransactions, useMyWallet } from '@/lib/hooks/use-wallet';
import { soundJackpot, soundWin } from '@/lib/sounds';
import { cn } from '@/lib/cn';

const MIN_DELTA = 1; // chips — ignora aumentos < 1 (rounding)
const JACKPOT_THRESHOLD = 5000; // chips — disparar confetti jackpot
const TOAST_TTL_MS = 4500;
const MAX_STACK = 3;

type WinToast = {
  id: number;
  delta: number;
  kind: 'win' | 'deposit' | 'bonus' | 'load' | 'jackpot' | 'generic';
};

const KIND_META: Record<
  WinToast['kind'],
  { label: string; icon: typeof Coins; color: string }
> = {
  win: { label: 'Ganaste', icon: PartyPopper, color: '#FFD700' },
  deposit: { label: 'Depósito acreditado', icon: TrendingUp, color: '#22c55e' },
  bonus: { label: 'Bonus acreditado', icon: Gift, color: '#FFD700' },
  load: { label: 'Carga del cajero', icon: Coins, color: '#FFD700' },
  jackpot: { label: '¡JACKPOT!', icon: Sparkles, color: '#FFD700' },
  generic: { label: 'Ingreso', icon: Coins, color: '#FFD700' },
};

export function WinToastWatcher() {
  const wallet = useMyWallet();
  const txs = useMyTransactions(5, 0);
  const prevBalanceRef = useRef<number | null>(null);
  const seenTxIdsRef = useRef<Set<string>>(new Set());
  const [stack, setStack] = useState<WinToast[]>([]);

  // Inicializar seenTxIds con las txs actuales al primer mount. Sin esto,
  // el primer fetch de useMyTransactions parecería traer "novedades" que
  // dispararían toasts falsos (al recargar la página).
  useEffect(() => {
    if (txs.data && seenTxIdsRef.current.size === 0) {
      for (const tx of txs.data.data) {
        seenTxIdsRef.current.add(tx.id);
      }
    }
  }, [txs.data]);

  const pushToast = useCallback((t: Omit<WinToast, 'id'>) => {
    const id = Date.now() + Math.random();
    setStack((prev) => [...prev.slice(-(MAX_STACK - 1)), { ...t, id }]);
    // Auto-dismiss
    window.setTimeout(() => {
      setStack((prev) => prev.filter((x) => x.id !== id));
    }, TOAST_TTL_MS);
  }, []);

  // ── Detector principal: cambio del balance ──────────────────────
  useEffect(() => {
    if (wallet.isLoading || !wallet.data) return;
    const current = Number(wallet.data.balance);
    const prev = prevBalanceRef.current;
    if (prev === null) {
      prevBalanceRef.current = current;
      return;
    }
    const delta = current - prev;
    prevBalanceRef.current = current;
    if (delta < MIN_DELTA) return;

    // Inferir motivo a partir de la última tx no vista que matchee
    // el delta (±0.01 para floats). Best-effort.
    const newTx = txs.data?.data.find(
      (tx) =>
        !seenTxIdsRef.current.has(tx.id) &&
        Math.abs(Number(tx.amount) - delta) < 0.01,
    );
    if (newTx) seenTxIdsRef.current.add(newTx.id);

    const kind = inferKind(delta, newTx?.type);
    pushToast({ delta, kind });

    // FX
    if (typeof window !== 'undefined') {
      const reduce =
        window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!reduce) {
        if (delta >= JACKPOT_THRESHOLD || kind === 'jackpot') {
          confettiJackpot();
          soundJackpot();
        } else {
          confettiSide();
          soundWin();
        }
      }
    }
  }, [wallet.data, wallet.isLoading, txs.data, pushToast]);

  // No render si no hay nada
  if (stack.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className={cn(
        'fixed z-50 pointer-events-none',
        // Mobile: top center con padding para no chocar header
        'top-[3.75rem] left-1/2 -translate-x-1/2 w-[min(92vw,360px)]',
        // Desktop: top-right
        'sm:top-20 sm:right-6 sm:left-auto sm:translate-x-0 sm:w-[340px]',
        'flex flex-col gap-2',
      )}
    >
      {stack.map((toast) => (
        <ToastCard
          key={toast.id}
          toast={toast}
          onDismiss={() =>
            setStack((prev) => prev.filter((x) => x.id !== toast.id))
          }
        />
      ))}
    </div>
  );
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: WinToast;
  onDismiss: () => void;
}) {
  const meta = KIND_META[toast.kind];
  const Icon = meta.icon;
  return (
    <div
      className={cn(
        'pointer-events-auto relative overflow-hidden',
        'bg-[var(--color-bg-elevated)] border border-[var(--color-border-strong)]',
        'shadow-[0_12px_40px_-12px_rgba(0,0,0,0.8)]',
        'animate-toast-slide-in',
      )}
      style={{ borderLeftColor: meta.color, borderLeftWidth: '3px' }}
      role="alert"
    >
      {/* Glow detrás del icon */}
      <div
        aria-hidden
        className="absolute -left-6 -top-6 size-24 blur-2xl opacity-50 pointer-events-none"
        style={{
          background: `radial-gradient(circle, ${meta.color}60 0%, transparent 70%)`,
        }}
      />
      {/* Shimmer sweep */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none overflow-hidden"
      >
        <div className="absolute inset-y-0 -inset-x-full animate-shine bg-gradient-to-r from-transparent via-white/15 to-transparent" />
      </div>

      <div className="relative flex items-center gap-3 p-3 sm:p-3.5">
        <div
          className="size-10 rounded-full flex items-center justify-center shrink-0"
          style={{
            background: `linear-gradient(135deg, ${meta.color}30, ${meta.color}10)`,
            border: `1px solid ${meta.color}`,
          }}
        >
          <Icon className="size-5" style={{ color: meta.color }} />
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <span
            className="text-[10px] uppercase tracking-[0.12em] font-medium"
            style={{ color: meta.color }}
          >
            {meta.label}
          </span>
          <span className="font-mono tabular-nums text-[18px] sm:text-[20px] text-[var(--color-fg)] tracking-tight">
            +{formatChips(toast.delta)} <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] font-sans">chips</span>
          </span>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="size-7 flex items-center justify-center text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg-subtle)] rounded-full transition-colors shrink-0"
          aria-label="Cerrar notificación"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* Progress bar fina que se vacía en TOAST_TTL_MS */}
      <div className="relative h-0.5 bg-[var(--color-border)]">
        <div
          className="absolute inset-y-0 left-0 animate-toast-progress origin-left"
          style={{ background: meta.color }}
        />
      </div>
    </div>
  );
}

function inferKind(delta: number, txType: string | undefined): WinToast['kind'] {
  if (delta >= JACKPOT_THRESHOLD) return 'jackpot';
  if (!txType) return 'generic';
  if (txType === 'win' || txType === 'jackpot_win') return 'win';
  if (txType === 'deposit') return 'deposit';
  if (
    txType === 'bonus_grant' ||
    txType === 'promo_reward' ||
    txType === 'league_reward' ||
    txType === 'bonus_clear'
  ) {
    return 'bonus';
  }
  if (txType === 'load' || txType === 'transfer_in' || txType === 'mint') {
    return 'load';
  }
  return 'generic';
}

function formatChips(n: number): string {
  return n.toLocaleString('es-AR', { maximumFractionDigits: 2 });
}
