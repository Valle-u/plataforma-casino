/**
 * /wallet â€” wallet del operador logueado.
 *
 * ComposiciÃ³n:
 *   - Header con tÃ­tulo + meta del wallet (id, version, currency).
 *   - Hero balance: monto grande mono + locked balance al lado.
 *   - 4 botones: Crear fichas (mint), Destruir fichas (burn),
 *     Cargar a usuario (load), Retirar de usuario (unload).
 *   - Tabla de transactions paginada con type / amount / balance / reason.
 */

'use client';

import {
  ArrowDownToLine,
  ArrowUpToLine,
  Coins,
  Flame,
  Hash,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { useState } from 'react';
import {
  LoadUnloadModal,
  type LoadUnloadMode,
} from '@/components/admin/load-unload-modal';
import { MintBurnModal, type MintBurnMode } from '@/components/admin/mint-burn-modal';
import { useAuth } from '@/lib/auth-context';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CsvExportButton } from '@/components/ui/csv-export-button';
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
  bonus_funding: 'info',
  bonus_funding_revert: 'neutral',
  bonus_clear: 'success',
  load: 'success',
  transfer_in: 'success',
  transfer_out: 'warning',
  unload: 'warning',
  deposit_credit: 'success',
  withdrawal_debit: 'warning',
  cashback_credit: 'success',
};

export default function WalletPage() {
  const { user: actor } = useAuth();
  const wallet = useMyWallet();
  const [page, setPage] = useState(0);
  const txs = useMyTransactions(PAGE_SIZE, page * PAGE_SIZE);
  const [mintBurnModal, setMintBurnModal] = useState<MintBurnMode | null>(null);
  const [loadUnloadModal, setLoadUnloadModal] = useState<LoadUnloadMode | null>(
    null,
  );

  return (
    <>
      <div className="p-6 lg:p-8 flex flex-col gap-8 max-w-[1600px] mx-auto">
        {/* â”€â”€ Header â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <header className="flex items-end justify-between gap-6 pb-2">
          <div className="flex flex-col gap-2">
            <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
              <Coins className="size-3" />
              OperaciÃ³n Â· Wallet
            </span>
            <h1 className="font-display text-[2.5rem] leading-none tracking-tight">
              Tu wallet
            </h1>
            <p className="text-sm text-[var(--color-fg-muted)] mt-1">
              Mint y burn impactan el supply total del tenant. Para
              operar contra wallets de otros usuarios usÃ¡ load/unload
              (prÃ³ximamente).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <CsvExportButton
              path="/tenant/wallet/me/transactions/export"
              filenameHint="wallet_transactions"
              entityLabel="transacciones"
            />
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                wallet.refetch();
                txs.refetch();
              }}
              disabled={wallet.isFetching || txs.isFetching}
            >
              <RefreshCw
                className={cn(
                  'size-3.5',
                  (wallet.isFetching || txs.isFetching) && 'animate-spin',
                )}
              />
              Refrescar
            </Button>
          </div>
        </header>

        {/* â”€â”€ Hero balance â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <section className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-px bg-[var(--color-border)]">
          {/* Balance principal */}
          <div className="bg-[var(--color-bg-elevated)] p-8 flex flex-col gap-6 relative overflow-hidden">
            {/* Glow rojo decorativo en esquina */}
            <div
              aria-hidden
              className="absolute -top-24 -right-24 size-72 rounded-full opacity-30 blur-3xl"
              style={{ background: 'var(--color-accent-glow)' }}
            />

            <div className="relative flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium">
                Balance disponible
              </span>
              {wallet.data && (
                <span className="text-[10px] font-mono text-[var(--color-fg-subtle)]">
                  Â· {wallet.data.currency}
                </span>
              )}
            </div>

            <div className="relative flex items-baseline gap-3 min-h-[4rem]">
              {wallet.isLoading ? (
                <Skeleton className="h-14 w-64 bg-[var(--color-bg-subtle)]" />
              ) : wallet.isError ? (
                <span className="font-display text-3xl text-[var(--color-fg-subtle)]">
                  â€”
                </span>
              ) : (
                <>
                  <span className="font-display text-[4rem] leading-none tabular-nums tracking-tight text-[var(--color-fg)]">
                    {formatBalance(wallet.data?.balance ?? '0')}
                  </span>
                  <span className="text-sm font-mono text-[var(--color-fg-subtle)] uppercase tracking-[0.14em]">
                    chips
                  </span>
                </>
              )}
            </div>

            <div className="relative flex items-center gap-6 text-[11px] text-[var(--color-fg-subtle)] uppercase tracking-[0.12em] pt-4 border-t border-[var(--color-border)]">
              <Meta
                icon={<ShieldCheck className="size-3" />}
                label="Bloqueado"
                value={wallet.data ? `${wallet.data.lockedBalance} chips` : 'â€”'}
              />
              <Meta
                icon={<Hash className="size-3" />}
                label="VersiÃ³n"
                value={wallet.data ? String(wallet.data.version) : 'â€”'}
              />
              <Meta
                label="Wallet ID"
                value={
                  wallet.data
                    ? wallet.data.id.slice(0, 8) + 'â€¦'
                    : 'â€”'
                }
                mono
              />
            </div>
          </div>

          {/* Acciones */}
          <div className="bg-[var(--color-bg-elevated)] p-6 flex flex-col gap-3">
            <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium pb-2 border-b border-[var(--color-border)]">
              Acciones
            </span>

            <ActionButton
              icon={Coins}
              title="Crear fichas"
              hint="Mint â€” suma supply al tenant"
              onClick={() => setMintBurnModal('mint')}
            />
            <ActionButton
              icon={Flame}
              title="Destruir fichas"
              hint="Burn â€” resta supply (audit obligatorio)"
              onClick={() => setMintBurnModal('burn')}
            />
            <ActionButton
              icon={ArrowDownToLine}
              title="Cargar a usuario"
              hint="Tu wallet â†’ wallet de jugador/cajero"
              onClick={() => setLoadUnloadModal('load')}
            />
            <ActionButton
              icon={ArrowUpToLine}
              title="Retirar de usuario"
              hint="Wallet de usuario â†’ tu wallet"
              onClick={() => setLoadUnloadModal('unload')}
            />
          </div>
        </section>

        {/* â”€â”€ Transactions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium">
              Movimientos Â· PÃ¡gina {page + 1}
              {txs.data && (
                <span className="ml-2 font-mono text-[var(--color-fg-subtle)]">
                  ({txs.data.total} total)
                </span>
              )}
            </h2>
            <Pager
              page={page}
              total={txs.data?.total ?? 0}
              onPrev={() => setPage((p) => Math.max(0, p - 1))}
              onNext={() => setPage((p) => p + 1)}
              hasMore={txs.data ? (page + 1) * PAGE_SIZE < txs.data.total : false}
            />
          </div>

          <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
            {txs.isLoading ? (
              <LoadingTable />
            ) : txs.isError ? (
              <div className="p-6">
                <EmptyState
                  hint="transactions"
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
            ) : !txs.data || txs.data.data.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  hint="transactions"
                  stream="wallet:me"
                  label="Tu wallet no tiene movimientos todavÃ­a"
                  action={
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => setMintBurnModal('mint')}
                    >
                      <Coins className="size-3.5" />
                      Hacer primer mint
                    </Button>
                  }
                />
              </div>
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>Tipo</TH>
                    <TH align="right">Monto</TH>
                    <TH align="right">Balance despuÃ©s</TH>
                    <TH>Motivo</TH>
                    <TH align="right">Fecha</TH>
                  </tr>
                </THead>
                <TBody>
                  {txs.data.data.map((tx, i) => (
                    <TxRow key={tx.id} tx={tx} index={i} />
                  ))}
                </TBody>
              </Table>
            )}
          </div>
        </section>
      </div>

      {/* Modal abre aunque wallet.data sea null â€” el backend re-valida el
       * balance al hacer el mint/burn. */}
      {mintBurnModal && (
        <MintBurnModal
          mode={mintBurnModal}
          open={!!mintBurnModal}
          onOpenChange={(o) => !o && setMintBurnModal(null)}
          currentBalance={wallet.data?.balance ?? '0'}
        />
      )}

      {loadUnloadModal && actor && (
        <LoadUnloadModal
          mode={loadUnloadModal}
          open={!!loadUnloadModal}
          onOpenChange={(o) => !o && setLoadUnloadModal(null)}
          actorUserId={actor.id}
        />
      )}
    </>
  );
}

function ActionButton({
  icon: Icon,
  title,
  hint,
  onClick,
}: {
  icon: typeof Coins;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-3 p-3 bg-[var(--color-bg-subtle)] hover:bg-[var(--color-bg-hover)] border border-[var(--color-border)] hover:border-[var(--color-accent-border)] transition-colors text-left"
    >
      <div className="size-9 shrink-0 border border-[var(--color-border-strong)] flex items-center justify-center text-[var(--color-fg-muted)] group-hover:text-[var(--color-accent-text)] group-hover:border-[var(--color-accent)] transition-colors">
        <Icon className="size-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-[var(--color-fg)] tracking-tight">{title}</div>
        <div className="text-[11px] text-[var(--color-fg-subtle)]">{hint}</div>
      </div>
    </button>
  );
}

function TxRow({ tx, index }: { tx: WalletTransaction; index: number }) {
  const variant = TX_TYPE_VARIANT[tx.type] ?? 'neutral';
  const isCredit =
    tx.type === 'mint' ||
    tx.type === 'load' ||
    tx.type === 'transfer_in' ||
    tx.type === 'bonus_clear' ||
    tx.type === 'deposit_credit' ||
    tx.type === 'cashback_credit';
  const sign = isCredit ? '+' : 'âˆ’';
  return (
    <TR
      className="animate-fade-up-staggered"
      style={{ animationDelay: `${Math.min(index * 25, 500)}ms` }}
    >
      <TD>
        <Badge variant={variant} dot>
          {tx.type}
        </Badge>
      </TD>
      <TD numeric>
        <span
          className={cn(
            isCredit
              ? 'text-[var(--color-success)]'
              : 'text-[var(--color-accent-text)]',
          )}
        >
          {sign} {tx.amount}
        </span>
      </TD>
      <TD numeric className="text-[var(--color-fg-muted)]">
        {tx.balanceAfter}
      </TD>
      <TD className="max-w-[400px]">
        <span
          className="text-[12px] text-[var(--color-fg-muted)] truncate block"
          title={tx.reason ?? undefined}
        >
          {tx.reason ?? 'â€”'}
        </span>
      </TD>
      <TD numeric className="text-[var(--color-fg-subtle)]">
        {formatDateTime(tx.createdAt)}
      </TD>
    </TR>
  );
}

function Meta({
  icon,
  label,
  value,
  mono,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1">
        {icon}
        <span>{label}</span>
      </span>
      <span
        className={cn(
          'text-[12px] normal-case tracking-normal text-[var(--color-fg)] tabular-nums',
          mono && 'font-mono',
        )}
      >
        {value}
      </span>
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
    <div className="flex items-center gap-3 text-[11px] text-[var(--color-fg-subtle)]">
      <span className="font-mono tabular-nums">
        {total === 0 ? 'â€”' : `${start}â€“${end}`}
      </span>
      <div className="flex items-center gap-px bg-[var(--color-border)]">
        <button
          type="button"
          onClick={onPrev}
          disabled={page === 0}
          className="px-3 h-7 text-[11px] uppercase tracking-[0.08em] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] disabled:opacity-40 disabled:hover:bg-[var(--color-bg-elevated)] disabled:cursor-not-allowed transition-colors"
        >
          â† Prev
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!hasMore}
          className="px-3 h-7 text-[11px] uppercase tracking-[0.08em] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] disabled:opacity-40 disabled:hover:bg-[var(--color-bg-elevated)] disabled:cursor-not-allowed transition-colors"
        >
          Next â†’
        </button>
      </div>
    </div>
  );
}

function LoadingTable() {
  return (
    <div className="p-4 flex flex-col gap-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-9 w-full bg-[var(--color-bg-subtle)]"
        />
      ))}
    </div>
  );
}

function formatBalance(balance: string): string {
  // "1234567.89" â†’ "1,234,567.89"
  const [int, dec] = balance.split('.');
  const withCommas = (int ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return dec !== undefined ? `${withCommas}.${dec}` : withCommas;
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('es-AR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
