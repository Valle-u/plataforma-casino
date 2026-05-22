/**
 * /play/wallet — wallet del jugador (saldo + transactions).
 *
 * Composición:
 *   - Hero balance card (similar al dashboard pero con más metadata).
 *   - Tabs filter de tx (Todos / Créditos / Débitos / Bonos).
 *   - Tabla cronológica de wallet_transactions paginada.
 *
 * Endpoints user-facing:
 *   - GET /tenant/wallet/me
 *   - GET /tenant/wallet/me/transactions?limit&offset
 *
 * MVP: sin acciones (depositar/retirar son sprints incrementales).
 */

'use client';

import { Coins, RefreshCw, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import {
  useMyTransactions,
  useMyWallet,
  type WalletTransaction,
} from '@/lib/hooks/use-wallet';
import { cn } from '@/lib/cn';

const PAGE_SIZE = 25;

const TX_TYPE_VARIANT: Record<string, BadgeVariant> = {
  mint: 'success',
  burn: 'danger',
  load: 'success',
  unload: 'warning',
  transfer_in: 'success',
  transfer_out: 'warning',
  bet: 'neutral',
  win: 'success',
  rollback: 'info',
  adjustment: 'neutral',
  bonus_grant: 'info',
  bonus_clear: 'success',
  bonus_forfeit: 'warning',
  bonus_funding: 'warning',
  bonus_funding_revert: 'success',
  deposit: 'success',
  withdrawal: 'warning',
  jackpot_win: 'success',
  promo_reward: 'info',
  league_reward: 'info',
};

const CREDIT_TYPES = new Set<string>([
  'mint',
  'load',
  'transfer_in',
  'win',
  'deposit',
  'bonus_grant',
  'bonus_clear',
  'bonus_funding_revert',
  'jackpot_win',
  'promo_reward',
  'league_reward',
  'commission_payout',
  'fund_release',
]);

type Filter = 'all' | 'credits' | 'debits' | 'bonuses';

const FILTER_TABS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'credits', label: 'Créditos' },
  { id: 'debits', label: 'Débitos' },
  { id: 'bonuses', label: 'Bonos' },
];

function matchesFilter(tx: WalletTransaction, filter: Filter): boolean {
  if (filter === 'all') return true;
  if (filter === 'credits') return CREDIT_TYPES.has(tx.type);
  if (filter === 'debits') return !CREDIT_TYPES.has(tx.type);
  if (filter === 'bonuses') return tx.type.startsWith('bonus_');
  return true;
}

export default function PlayWalletPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(0);
  const wallet = useMyWallet();
  const txs = useMyTransactions(PAGE_SIZE, page * PAGE_SIZE);

  const filteredRows = useMemo(
    () => (txs.data?.data ?? []).filter((tx) => matchesFilter(tx, filter)),
    [txs.data, filter],
  );

  const total = txs.data?.total ?? 0;
  const isFetching = wallet.isFetching || txs.isFetching;

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-10 flex flex-col gap-8">
      {/* Header */}
      <header className="flex items-end justify-between gap-6 pb-2">
        <div className="flex flex-col gap-2">
          <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
            <Coins className="size-3" />
            Tu wallet
          </span>
          <h1 className="font-display text-[2.5rem] leading-none tracking-tight">
            Saldo y movimientos
          </h1>
        </div>
        <Button
          variant="secondary"
          size="md"
          onClick={() => {
            wallet.refetch();
            txs.refetch();
          }}
          disabled={isFetching}
        >
          <RefreshCw
            className={cn('size-3.5', isFetching && 'animate-spin')}
          />
          Refrescar
        </Button>
      </header>

      {/* Hero balance */}
      <section className="relative">
        <div
          aria-hidden
          className="absolute -inset-x-8 -top-8 h-48 opacity-30 blur-3xl pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse at center, var(--color-accent-glow) 0%, transparent 65%)',
          }}
        />
        <div className="relative border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-8 grid grid-cols-1 md:grid-cols-3 gap-px md:bg-[var(--color-border)]">
          <BalanceCell
            label="Disponible"
            value={wallet.data?.balance}
            loading={wallet.isLoading}
            highlight
          />
          <BalanceCell
            label="En hold"
            value={wallet.data?.lockedBalance}
            loading={wallet.isLoading}
            hint="Retiros pendientes"
          />
          <MetaCell
            walletId={wallet.data?.id}
            version={wallet.data?.version}
            loading={wallet.isLoading}
          />
        </div>
      </section>

      {/* Tabs filter */}
      <div className="flex items-center gap-px bg-[var(--color-border)] border border-[var(--color-border)] self-start">
        {FILTER_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setFilter(t.id);
              setPage(0);
            }}
            className={cn(
              'px-4 h-8 text-[11px] uppercase tracking-[0.08em] font-medium',
              'transition-colors duration-150',
              filter === t.id
                ? 'bg-[var(--color-bg)] text-[var(--color-fg)] border-b-2 border-b-[var(--color-accent)]'
                : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Transactions */}
      <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
        {txs.isLoading ? (
          <LoadingTable />
        ) : txs.isError ? (
          <div className="p-6">
            <EmptyState
              hint="wallet_transactions"
              label="No se pudo cargar el historial."
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => txs.refetch()}
                >
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
          <Table>
            <THead>
              <tr>
                <TH>Tipo</TH>
                <TH>Detalle</TH>
                <TH align="right">Monto</TH>
                <TH align="right">Saldo después</TH>
                <TH align="right">Fecha</TH>
              </tr>
            </THead>
            <TBody>
              {filteredRows.map((tx, i) => {
                const isCredit = CREDIT_TYPES.has(tx.type);
                const sign = isCredit ? '+' : '−';
                return (
                  <TR
                    key={tx.id}
                    className="animate-fade-up-staggered"
                    style={{ animationDelay: `${Math.min(i * 20, 400)}ms` }}
                  >
                    <TD>
                      <Badge
                        variant={TX_TYPE_VARIANT[tx.type] ?? 'neutral'}
                        dot
                      >
                        {tx.type}
                      </Badge>
                    </TD>
                    <TD>
                      <span className="text-[12px] text-[var(--color-fg-muted)] truncate max-w-[320px] inline-block">
                        {tx.reason ?? '—'}
                      </span>
                    </TD>
                    <TD numeric>
                      <span
                        className={cn(
                          'font-mono tabular-nums',
                          isCredit
                            ? 'text-[var(--color-success)]'
                            : 'text-[var(--color-fg)]',
                        )}
                      >
                        {sign}
                        {Number(tx.amount).toLocaleString('es-AR')}
                      </span>
                    </TD>
                    <TD numeric className="text-[var(--color-fg-muted)]">
                      {Number(tx.balanceAfter).toLocaleString('es-AR')}
                    </TD>
                    <TD numeric className="text-[var(--color-fg-subtle)]">
                      {formatDate(tx.createdAt)}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </div>

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
// Sub-components
// ──────────────────────────────────────────────────────────────────────

function BalanceCell({
  label,
  value,
  loading,
  hint,
  highlight,
}: {
  label: string;
  value: string | undefined;
  loading: boolean;
  hint?: string;
  highlight?: boolean;
}) {
  return (
    <div className="bg-[var(--color-bg-elevated)] p-6 flex flex-col gap-2">
      <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-medium">
        {label}
      </span>
      <div className="flex items-baseline gap-2">
        <span
          className={cn(
            'font-display tabular-nums leading-none',
            highlight
              ? 'text-[2.75rem] text-[var(--color-fg)]'
              : 'text-2xl text-[var(--color-fg-muted)]',
          )}
        >
          {loading
            ? '—'
            : value
              ? Number(value).toLocaleString('es-AR', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })
              : '0,00'}
        </span>
        <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)] font-mono">
          CHIPS
        </span>
      </div>
      {hint && (
        <span className="text-[10px] text-[var(--color-fg-subtle)] italic">
          {hint}
        </span>
      )}
    </div>
  );
}

function MetaCell({
  walletId,
  version,
  loading,
}: {
  walletId: string | undefined;
  version: number | undefined;
  loading: boolean;
}) {
  return (
    <div className="bg-[var(--color-bg-elevated)] p-6 flex flex-col gap-3">
      <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-medium">
        Wallet
      </span>
      <div className="flex flex-col gap-1.5 text-[10px] font-mono text-[var(--color-fg-subtle)]">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="size-3 text-[var(--color-success)]" />
          <span className="uppercase tracking-[0.1em]">verificado</span>
        </div>
        <span className="break-all">
          id: {loading ? '—' : walletId?.slice(0, 13) + '…'}
        </span>
        <span>
          version: {loading || version === undefined ? '—' : version}
        </span>
      </div>
    </div>
  );
}

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
      <span className="font-mono tabular-nums">
        {total === 0 ? '—' : `${start}–${end} de ${total}`}
      </span>
      <div className="flex items-center gap-px bg-[var(--color-border)]">
        <button
          type="button"
          onClick={onPrev}
          disabled={page === 0}
          className="px-3 h-7 text-[11px] uppercase tracking-[0.08em] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Anterior
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!hasMore}
          className="px-3 h-7 text-[11px] uppercase tracking-[0.08em] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}

function LoadingTable() {
  return (
    <div className="p-4 flex flex-col gap-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full bg-[var(--color-bg-subtle)]" />
      ))}
    </div>
  );
}

function formatDate(iso: string | Date): string {
  try {
    const d = typeof iso === 'string' ? new Date(iso) : iso;
    return d.toLocaleDateString('es-AR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return String(iso);
  }
}
