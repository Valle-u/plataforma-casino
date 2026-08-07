/**
 * /play/wallet — Movimientos del jugador (rediseño "Neón Milonga", TANGO).
 *
 * Pantalla "Movimientos" del handoff. El chrome lo provee play/layout.tsx.
 *
 * Composición:
 *   - Header: kicker "Tu wallet" + título "Movimientos" + Refrescar.
 *   - 3 tarjetas: Disponible (animada) · En hold · estado Wallet (verificado).
 *   - Tabs filtro (Todos / Créditos / Débitos / Bonos) con conteo.
 *   - Lista de transacciones (icono circular por tipo + título + estado + monto).
 *   - Pager.
 *
 * Función PRESERVADA del wallet anterior:
 *   - useMyWallet (GET /tenant/wallet/me): balance, lockedBalance, id, version.
 *   - useMyTransactions (GET /tenant/wallet/me/transactions?limit&offset).
 *   - Filtros por tipo (matchesFilter) + paginación + balance animado.
 *
 * Ocultamiento de juego: las apuestas/ganancias/reversos (bet, win,
 * jackpot_win, rollback) se excluyen server-side vía `excludeTypes` para
 * que paginación y totales queden coherentes con lo visible.
 */

'use client';

import {
  Coins,
  Gift,
  Minus,
  Plus,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useAnimatedNumber } from '@/lib/hooks/use-animated-number';
import {
  useMyTransactions,
  useMyWallet,
  type WalletTransaction,
} from '@/lib/hooks/use-wallet';
import { cn } from '@/lib/cn';

const PAGE_SIZE = 25;

/**
 * Tipos de movimiento de Juego que se ocultan de la lista de movimientos
 * del player. La pantalla muestra solo cargas, retiros y bonos; las
 * apuestas/ganancias/reversos de juego no aparecen (filtro server-side vía
 * `excludeTypes` para que paginación y totales queden coherentes).
 */
const HIDDEN_GAME_TX_TYPES = ['bet', 'win', 'jackpot_win', 'rollback'];

const CREDIT_TYPES = new Set<string>([
  'mint',
  'load',
  'transfer_in',
  'win',
  'deposit',
  'bonus_grant',
  'bonus_clear',
  'bonus_credit',
  'bonus_funding_revert',
  'jackpot_win',
  'promo_reward',
  'league_reward',
  'commission_payout',
  'fund_release',
]);

/** type → etiqueta legible para el título de la fila. */
const TYPE_LABEL: Record<string, string> = {
  deposit: 'Depósito acreditado',
  mint: 'Carga de fichas',
  load: 'Carga de fichas',
  win: 'Ganancia',
  bet: 'Apuesta',
  withdrawal: 'Retiro',
  burn: 'Débito',
  unload: 'Descarga',
  transfer_in: 'Transferencia recibida',
  transfer_out: 'Transferencia enviada',
  bonus_grant: 'Bono otorgado',
  bonus_clear: 'Bono liberado',
  bonus_forfeit: 'Bono perdido',
  bonus_credit: 'Bono acreditado',
  bonus_debit: 'Bono consumido',
  bonus_funding: 'Fondeo de bono',
  bonus_funding_revert: 'Reverso de fondeo',
  rollback: 'Reverso',
  adjustment: 'Ajuste',
  jackpot_win: 'Jackpot',
  promo_reward: 'Premio de promoción',
  league_reward: 'Premio de liga',
  commission_payout: 'Comisión',
  fund_release: 'Liberación de fondos',
};

function typeLabel(t: string): string {
  return TYPE_LABEL[t] ?? t.replace(/_/g, ' ');
}

type Filter = 'all' | 'credits' | 'debits' | 'bonuses';

const FILTER_TABS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'credits', label: 'Créditos' },
  { id: 'debits', label: 'Débitos' },
  { id: 'bonuses', label: 'Bonos' },
];

function isBonus(tx: WalletTransaction): boolean {
  return tx.type.startsWith('bonus_');
}

function matchesFilter(tx: WalletTransaction, filter: Filter): boolean {
  if (filter === 'all') return true;
  if (filter === 'credits') return CREDIT_TYPES.has(tx.type);
  if (filter === 'debits') return !CREDIT_TYPES.has(tx.type);
  if (filter === 'bonuses') return isBonus(tx);
  return true;
}

export default function PlayWalletPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(0);
  const wallet = useMyWallet();
  const txs = useMyTransactions(PAGE_SIZE, page * PAGE_SIZE, HIDDEN_GAME_TX_TYPES);

  const allRows = txs.data?.data ?? [];
  const filteredRows = useMemo(
    () => allRows.filter((tx) => matchesFilter(tx, filter)),
    [allRows, filter],
  );

  const counts = useMemo(
    () => ({
      all: allRows.length,
      credits: allRows.filter((t) => CREDIT_TYPES.has(t.type)).length,
      debits: allRows.filter((t) => !CREDIT_TYPES.has(t.type)).length,
      bonuses: allRows.filter(isBonus).length,
    }),
    [allRows],
  );

  const total = txs.data?.total ?? 0;
  const isFetching = wallet.isFetching || txs.isFetching;

  return (
    <div className="flex flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      {/* Header */}
      <header className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent-text)]">
            <Coins className="size-3" />
            Tu wallet
          </span>
          <h1 className="font-display text-[34px] leading-none">Movimientos</h1>
        </div>
        <Button
          variant="secondary"
          size="md"
          onClick={() => {
            wallet.refetch();
            txs.refetch();
          }}
          disabled={isFetching}
          className="shrink-0"
        >
          <RefreshCw className={cn('size-3.5', isFetching && 'animate-spin')} />
          <span className="hidden sm:inline">Refrescar</span>
        </Button>
      </header>

      {/* 4 tarjetas: Disponible · Bono · En hold · Wallet */}
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

      {/* Tabs filtro con conteo */}
      <div className="flex flex-wrap items-center gap-2">
        {FILTER_TABS.map((t) => {
          const active = filter === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setFilter(t.id);
                setPage(0);
              }}
              aria-pressed={active}
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-medium transition-colors',
                active
                  ? 'text-[var(--color-accent-fg)]'
                  : 'border border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] hover:border-[var(--color-accent-border)] hover:text-[var(--color-fg)]',
              )}
              style={active ? { background: 'var(--gradient-accent)' } : undefined}
            >
              {t.label}
              <span
                className={cn(
                  'text-[11px] tabular-nums',
                  active ? 'opacity-80' : 'text-[var(--color-fg-subtle)]',
                )}
              >
                {counts[t.id]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Lista de transacciones */}
      <section className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
        {txs.isLoading ? (
          <LoadingList />
        ) : txs.isError ? (
          <div className="p-6">
            <EmptyState
              hint="wallet_transactions"
              label="No se pudo cargar el historial."
              action={
                <Button variant="secondary" size="sm" onClick={() => txs.refetch()}>
                  Reintentar
                </Button>
              }
            />
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              hint="wallet_transactions"
              label={
                filter === 'all'
                  ? 'Sin movimientos todavía'
                  : 'Sin movimientos en este filtro'
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {filteredRows.map((tx) => (
              <TxRow key={tx.id} tx={tx} />
            ))}
          </ul>
        )}
      </section>

      {/* Pager */}
      {txs.data && total > PAGE_SIZE && (
        <Pager
          page={page}
          total={total}
          onPrev={() => setPage((p) => Math.max(0, p - 1))}
          onNext={() => setPage((p) => p + 1)}
          hasMore={(page + 1) * PAGE_SIZE < total}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Transacción
// ──────────────────────────────────────────────────────────────────────

function TxRow({ tx }: { tx: WalletTransaction }) {
  const credit = CREDIT_TYPES.has(tx.type);
  const bonus = isBonus(tx);
  const tone = bonus ? 'var(--color-gold)' : credit ? 'var(--color-success)' : 'var(--color-danger)';
  const Icon = bonus ? Gift : credit ? Plus : Minus;
  const sign = credit ? '+' : '−';

  return (
    <li className="flex items-center gap-3 px-4 py-3.5">
      {/* Icono circular coloreado por tipo */}
      <span
        className="grid size-9 shrink-0 place-items-center rounded-full"
        style={{
          background: `color-mix(in srgb, ${tone} 20%, transparent)`,
          color: tone,
          boxShadow: `0 0 12px -4px ${tone}`,
        }}
        aria-hidden
      >
        <Icon className="size-4" />
      </span>

      {/* Título + subtítulo */}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[14px] font-medium text-[var(--color-fg)]">
          {typeLabel(tx.type)}
        </span>
        <span className="truncate text-[11px] text-[var(--color-fg-subtle)]">
          {formatWhen(tx.createdAt)}
          {tx.reason ? ` · ${tx.reason}` : ''}
        </span>
      </div>

      {/* Estado */}
      <span
        className="hidden shrink-0 text-[9px] font-semibold uppercase tracking-[0.14em] sm:inline"
        style={{ color: credit ? 'var(--color-success)' : 'var(--color-fg-subtle)' }}
      >
        {credit ? 'Acreditado' : 'Completado'}
      </span>

      {/* Monto */}
      <span
        className="shrink-0 text-right text-[15px] font-semibold tabular-nums"
        style={{ color: credit ? 'var(--color-success)' : 'var(--color-danger)' }}
      >
        {sign}{' '}
        {Number(tx.amount).toLocaleString('es-AR', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
      </span>
    </li>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Tarjetas de saldo
// ──────────────────────────────────────────────────────────────────────

function BalanceCard({
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

function WalletStatusCard({
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

// ──────────────────────────────────────────────────────────────────────
// Pager + loading
// ──────────────────────────────────────────────────────────────────────

function Pager({
  page,
  total,
  onPrev,
  onNext,
  hasMore,
}: {
  page: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  hasMore: boolean;
}) {
  const start = page * PAGE_SIZE + 1;
  const end = Math.min(start + PAGE_SIZE - 1, total);
  return (
    <div className="flex items-center justify-end gap-3 text-[11px] text-[var(--color-fg-subtle)]">
      <span className="tabular-nums">
        {total === 0 ? '—' : `${start}–${end} de ${total}`}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPrev}
          disabled={page === 0}
          className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 text-[12px] transition-colors hover:border-[var(--color-accent-border)] hover:text-[var(--color-fg)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Anterior
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!hasMore}
          className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 text-[12px] transition-colors hover:border-[var(--color-accent-border)] hover:text-[var(--color-fg)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}

function LoadingList() {
  return (
    <div className="flex flex-col gap-2 p-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full bg-[var(--color-bg-subtle)]" />
      ))}
    </div>
  );
}

function formatWhen(iso: string | Date): string {
  try {
    const d = typeof iso === 'string' ? new Date(iso) : iso;
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    const time = d.toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
    });
    if (sameDay) return `Hoy · ${time}`;
    const date = d.toLocaleDateString('es-AR', {
      day: '2-digit',
      month: 'short',
    });
    return `${date} · ${time}`;
  } catch {
    return String(iso);
  }
}
