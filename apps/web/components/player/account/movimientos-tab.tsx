'use client';

/**
 * Tab "Movimientos" de /play/account (docs/21-plan-perfil-wallet.md).
 *
 * La lista filtrable que vivía en /play/wallet, sin las tarjetas de saldo
 * (ahora en el tab "Mi dinero") y sin el header de página (lo pone
 * /play/account). Preserva el filtro server-side de tipos de juego vía
 * `excludeTypes` para que paginación y totales queden coherentes.
 */

import { Gift, Minus, Plus, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useMyTransactions,
  type WalletTransaction,
} from '@/lib/hooks/use-wallet';
import { cn } from '@/lib/cn';

const PAGE_SIZE = 25;

/**
 * Tipos de movimiento que se ocultan de la lista del player: apuestas,
 * ganancias, reversos de juego y consumo de bono (filtro server-side).
 */
const HIDDEN_GAME_TX_TYPES = ['bet', 'win', 'jackpot_win', 'rollback', 'bonus_debit'];

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

export function MovimientosTab() {
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(0);
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
  const isFetching = txs.isFetching;

  return (
    <div className="flex flex-col gap-4">
      {/* Filtros con conteo + refrescar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
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
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void txs.refetch()}
          disabled={isFetching}
          className="shrink-0"
        >
          <RefreshCw className={cn('size-3.5', isFetching && 'animate-spin')} />
          Refrescar
        </Button>
      </div>

      {/* Lista */}
      <section className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
        {txs.isLoading ? (
          <LoadingList />
        ) : txs.isError ? (
          <div className="p-6">
            <EmptyState
              label="Ups, no pudimos cargar tus movimientos."
              description="Esperá unos segundos y probá de nuevo."
              action={
                <Button variant="secondary" size="sm" onClick={() => void txs.refetch()}>
                  Reintentar
                </Button>
              }
            />
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              label={
                filter === 'all'
                  ? 'Todavía no hay movimientos.'
                  : 'No hay movimientos en esta categoría.'
              }
              description={
                filter === 'all'
                  ? 'Cuando cargues o retires fichas, tus movimientos van a aparecer acá.'
                  : undefined
              }
              action={
                filter === 'all' ? (
                  <Button variant="primary" size="sm" asChild>
                    <Link href="/play/deposits">
                      <Plus className="size-3.5" />
                      Cargar fichas
                    </Link>
                  </Button>
                ) : undefined
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

      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[14px] font-medium text-[var(--color-fg)]">
          {typeLabel(tx.type)}
        </span>
        <span className="truncate text-[11px] text-[var(--color-fg-subtle)]">
          {formatWhen(tx.createdAt)}
          {tx.reason ? ` · ${tx.reason}` : ''}
        </span>
      </div>

      <span
        className="hidden shrink-0 text-[9px] font-semibold uppercase tracking-[0.14em] sm:inline"
        style={{ color: credit ? 'var(--color-success)' : 'var(--color-fg-subtle)' }}
      >
        {credit ? 'Acreditado' : 'Completado'}
      </span>

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
