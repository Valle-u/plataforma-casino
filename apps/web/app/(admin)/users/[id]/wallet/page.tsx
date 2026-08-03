/**
 * /users/:id/wallet — wallet de un user específico (visto por el admin/cajero).
 *
 * Composición:
 *   - Breadcrumb visual: header con link "← Volver a usuarios".
 *   - Card user mini (avatar + nombre + status).
 *   - Hero balance (igual que /wallet pero sin glow rojo — no es la wallet del actor).
 *   - Botones load/unload con presetTargetUser ya seteado.
 *   - Tabla de transactions del user paginada.
 */

'use client';

import { ArrowDownToLine, ArrowLeft, ArrowUpToLine, RefreshCw, Sliders, Store, Wrench } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { CorrectionModal } from '@/components/admin/correction-modal';
import { EditCorrectionCapModal } from '@/components/admin/edit-correction-cap-modal';
import {
  LoadUnloadModal,
  type LoadUnloadMode,
} from '@/components/admin/load-unload-modal';
import { useUserCap } from '@/lib/hooks/use-correction';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CsvExportButton } from '@/components/ui/csv-export-button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { useAuth, isAdminTenant, isIndependentBranch } from '@/lib/auth-context';
import { useUserDetail } from '@/lib/hooks/use-users';
import {
  useUserTransactions,
  useUserWallet,
  type WalletTransaction,
} from '@/lib/hooks/use-wallet';
import { cn } from '@/lib/cn';

const PAGE_SIZE = 25;

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  active: 'success',
  banned: 'danger',
  suspended: 'warning',
  pending: 'neutral',
};

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

export default function UserWalletPage() {
  const params = useParams<{ id: string }>();
  const userId = params.id;
  const { user: actor } = useAuth();
  const userQ = useUserDetail(userId);
  const walletQ = useUserWallet(userId);
  const [page, setPage] = useState(0);
  const txsQ = useUserTransactions(userId, PAGE_SIZE, page * PAGE_SIZE);
  const [modal, setModal] = useState<LoadUnloadMode | null>(null);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [capOpen, setCapOpen] = useState(false);
  // Carga por corrección: SOLO empleados de la red central (rol 'empleado',
  // rama dependiente). El admin carga con wallet.load (tesorería) y los
  // socios independientes venden fichas por /branches (docs/19).
  const canCorrect =
    actor?.roles?.includes('empleado') === true &&
    !isAdminTenant(actor) &&
    !isIndependentBranch(actor) &&
    (actor.effectivePermissions?.includes('wallet.correct') ?? false);
  const canEditCap =
    actor?.effectivePermissions === undefined ||
    actor.effectivePermissions.includes('users.edit');
  const capQ = useUserCap(canEditCap && actor?.id !== userId ? userId : null);

  // Sprint 51.10: TenantUserRow ahora incluye campos enriquecidos del
  // list (roleCodes, parent, balance, lastLogin). En esta pantalla
  // venimos de useUserDetail (no del list), así que esos campos no
  // están disponibles — pasamos defaults razonables y el modal solo
  // usa los básicos (id, username, displayName).
  const targetUserRow = userQ.data
    ? {
        id: userQ.data.user.id,
        username: userQ.data.user.username,
        email: userQ.data.user.email,
        displayName: userQ.data.user.displayName,
        status: userQ.data.user.status,
        createdAt: userQ.data.user.createdAt,
        lastLoginAt: null,
        roleCodes: [],
        parentUserId: null,
        parentUsername: null,
        walletBalance: walletQ.data?.balance ?? null,
        bonusBalance: walletQ.data?.bonusBalance ?? null,
        isIndependentBranch: !!userQ.data?.user.isIndependentBranch,
        underIndependentBranch: !!userQ.data?.user.underIndependentBranch,
      }
    : null;

  return (
    <>
      <div className="p-6 lg:p-8 flex flex-col gap-8 max-w-[1600px] mx-auto">
        {/* Breadcrumb mini */}
        <Link
          href="/users"
          className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] transition-colors flex items-center gap-1.5 self-start"
        >
          <ArrowLeft className="size-3" />
          Volver a usuarios
        </Link>

        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-2">
          <div className="flex items-center gap-4">
            <Avatar
              name={
                userQ.data?.user.displayName ?? userQ.data?.user.username ?? '?'
              }
              size="lg"
            />
            <div className="flex flex-col gap-2">
              <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium">
                Wallet de usuario
              </span>
              <h1 className="font-display text-3xl lg:text-[2.5rem] leading-none tracking-tight flex items-center gap-3 flex-wrap">
                {userQ.isLoading
                  ? '…'
                  : userQ.data?.user.displayName ?? userQ.data?.user.username}
                {userQ.data && (
                  <Badge
                    variant={STATUS_VARIANT[userQ.data.user.status] ?? 'neutral'}
                    dot
                  >
                    {userQ.data.user.status}
                  </Badge>
                )}
              </h1>
              <p className="text-sm text-[var(--color-fg-muted)] mt-1 font-mono">
                @{userQ.data?.user.username ?? userId.slice(0, 13) + '…'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <CsvExportButton
              path={`/tenant/wallet/user/${userId}/transactions/export`}
              filenameHint={`wallet_user_${userId.slice(0, 8)}`}
              entityLabel="transacciones del usuario"
            />
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                walletQ.refetch();
                txsQ.refetch();
              }}
              disabled={walletQ.isFetching || txsQ.isFetching}
            >
              <RefreshCw
                className={cn(
                  'size-3.5',
                  (walletQ.isFetching || txsQ.isFetching) && 'animate-spin',
                )}
              />
              Refrescar
            </Button>
          </div>
        </header>

        {/* Hero balance + acciones */}
        <section className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-px bg-[var(--color-border)]">
          <div className="bg-[var(--color-bg-elevated)] p-8 flex flex-col gap-6">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium">
                Balance disponible
              </span>
              {walletQ.data && (
                <span className="text-[10px] font-mono text-[var(--color-fg-subtle)]">
                  · {walletQ.data.currency}
                </span>
              )}
            </div>
            <div className="flex items-baseline gap-3 min-h-[4rem]">
              {walletQ.isLoading ? (
                <Skeleton className="h-14 w-64 bg-[var(--color-bg-subtle)]" />
              ) : walletQ.isError ? (
                <span className="font-display text-3xl text-[var(--color-fg-subtle)]">
                  —
                </span>
              ) : (
                <>
                  <span className="font-display text-[4rem] leading-none tabular-nums tracking-tight text-[var(--color-fg)]">
                    {formatBalance(walletQ.data?.balance ?? '0')}
                  </span>
                  <span className="text-sm font-mono text-[var(--color-fg-subtle)] uppercase tracking-[0.14em]">
                    fichas
                  </span>
                </>
              )}
            </div>

            <div className="flex items-center gap-6 text-[11px] text-[var(--color-fg-subtle)] uppercase tracking-[0.12em] pt-4 border-t border-[var(--color-border)]">
              <Meta
                label="Bloqueado"
                value={walletQ.data ? `${walletQ.data.lockedBalance} fichas` : '—'}
              />
              <Meta
                label="Versión"
                value={walletQ.data ? String(walletQ.data.version) : '—'}
              />
              <Meta
                label="Wallet ID"
                value={walletQ.data ? walletQ.data.id.slice(0, 8) + '…' : '—'}
                mono
              />
            </div>
          </div>

          {/* Acciones */}
          <div className="bg-[var(--color-bg-elevated)] p-6 flex flex-col gap-3">
            <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium pb-2 border-b border-[var(--color-border)]">
              Acciones
            </span>

            <button
              type="button"
              onClick={() => setModal('load')}
              disabled={!targetUserRow || actor?.id === userId || targetUserRow.isIndependentBranch}
              className="group flex items-center gap-3 p-3 bg-[var(--color-bg-subtle)] hover:bg-[var(--color-bg-hover)] border border-[var(--color-border)] hover:border-[var(--color-accent-border)] transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[var(--color-bg-subtle)]"
              title={targetUserRow?.isIndependentBranch ? 'El socio independiente se abastece por la venta de fichas (Sucursales).' : undefined}
            >
              <div className="size-9 shrink-0 border border-[var(--color-border-strong)] flex items-center justify-center text-[var(--color-fg-muted)] group-hover:text-[var(--color-accent-text)] group-hover:border-[var(--color-accent)] transition-colors">
                <ArrowDownToLine className="size-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-[var(--color-fg)] tracking-tight">
                  Cargar fichas
                </div>
                <div className="text-[11px] text-[var(--color-fg-subtle)]">
                  Tu wallet → este usuario
                </div>
              </div>
            </button>

            {targetUserRow?.isIndependentBranch && (
              <Link
                href="/branches"
                className="group flex items-center gap-3 p-3 bg-[var(--color-bg-subtle)] hover:bg-[var(--color-bg-hover)] border border-[var(--color-border)] hover:border-[var(--color-success)] transition-colors text-left"
              >
                <div className="size-9 shrink-0 border border-[var(--color-border-strong)] flex items-center justify-center text-[var(--color-fg-muted)] group-hover:text-[var(--color-success)] group-hover:border-[var(--color-success)] transition-colors">
                  <Store className="size-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-[var(--color-fg)] tracking-tight">
                    Venderle fichas
                  </div>
                  <div className="text-[11px] text-[var(--color-fg-subtle)]">
                    Socio independiente — venta de fichas (Sucursales)
                  </div>
                </div>
              </Link>
            )}

            <button
              type="button"
              onClick={() => setModal('unload')}
              disabled={!targetUserRow || actor?.id === userId}
              className="group flex items-center gap-3 p-3 bg-[var(--color-bg-subtle)] hover:bg-[var(--color-bg-hover)] border border-[var(--color-border)] hover:border-[var(--color-accent-border)] transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[var(--color-bg-subtle)]"
            >
              <div className="size-9 shrink-0 border border-[var(--color-border-strong)] flex items-center justify-center text-[var(--color-fg-muted)] group-hover:text-[var(--color-accent-text)] group-hover:border-[var(--color-accent)] transition-colors">
                <ArrowUpToLine className="size-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-[var(--color-fg)] tracking-tight">
                  Retirar fichas
                </div>
                <div className="text-[11px] text-[var(--color-fg-subtle)]">
                  Este usuario → tu wallet
                </div>
              </div>
            </button>

            {canCorrect && actor?.id !== userId && !targetUserRow?.isIndependentBranch && (
              <button
                type="button"
                onClick={() => setCorrectionOpen(true)}
                disabled={!targetUserRow}
                className="group flex items-center gap-3 p-3 bg-[var(--color-bg-subtle)] hover:bg-[var(--color-bg-hover)] border border-[var(--color-border)] hover:border-[var(--color-accent-border)] transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[var(--color-bg-subtle)]"
              >
                <div className="size-9 shrink-0 border border-[var(--color-border-strong)] flex items-center justify-center text-[var(--color-fg-muted)] group-hover:text-[var(--color-accent-text)] group-hover:border-[var(--color-accent)] transition-colors">
                  <Wrench className="size-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-[var(--color-fg)] tracking-tight">
                    Carga por corrección
                  </div>
                  <div className="text-[11px] text-[var(--color-fg-subtle)]">
                    Corrección / bonificación / reintegro (contra tu cupo)
                  </div>
                </div>
              </button>
            )}

            {canEditCap && actor?.id !== userId && (
              <button
                type="button"
                onClick={() => setCapOpen(true)}
                disabled={!targetUserRow}
                className="group flex items-center gap-3 p-3 bg-[var(--color-bg-subtle)] hover:bg-[var(--color-bg-hover)] border border-[var(--color-border)] hover:border-[var(--color-accent-border)] transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[var(--color-bg-subtle)]"
              >
                <div className="size-9 shrink-0 border border-[var(--color-border-strong)] flex items-center justify-center text-[var(--color-fg-muted)] group-hover:text-[var(--color-accent-text)] group-hover:border-[var(--color-accent)] transition-colors">
                  <Sliders className="size-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-[var(--color-fg)] tracking-tight">
                    Configurar cupo de correcciones
                  </div>
                  <div className="text-[11px] text-[var(--color-fg-subtle)]">
                    {capQ.data
                      ? `Cupo actual: ${Number(capQ.data.cap).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / mes`
                      : 'Fijar techo mensual para cargas por corrección'}
                  </div>
                </div>
              </button>
            )}

            {actor?.id === userId && (
              <p className="text-[11px] text-[var(--color-fg-subtle)] italic mt-2">
                Esta es tu propia wallet. Para mint/burn, usá la página principal de Wallet.
              </p>
            )}
          </div>
        </section>

        {/* Transactions */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium">
              Movimientos · Página {page + 1}
              {txsQ.data && (
                <span className="ml-2 font-mono text-[var(--color-fg-subtle)]">
                  ({txsQ.data.total} total)
                </span>
              )}
            </h2>
            <Pager
              page={page}
              total={txsQ.data?.total ?? 0}
              onPrev={() => setPage((p) => Math.max(0, p - 1))}
              onNext={() => setPage((p) => p + 1)}
              hasMore={
                txsQ.data ? (page + 1) * PAGE_SIZE < txsQ.data.total : false
              }
            />
          </div>

          <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto">
            {txsQ.isLoading ? (
              <LoadingTable />
            ) : txsQ.isError ? (
              <div className="p-6">
                <EmptyState
                  hint="transactions"
                  label="No se pudo cargar el historial."
                  action={
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => txsQ.refetch()}
                    >
                      Reintentar
                    </Button>
                  }
                />
              </div>
            ) : !txsQ.data || txsQ.data.data.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  hint="transactions"
                  stream={`wallet:user:${userId.slice(0, 8)}`}
                  label="Este usuario aún no tiene movimientos"
                />
              </div>
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>Tipo</TH>
                    <TH align="right">Monto</TH>
                    <TH align="right">Balance después</TH>
                    <TH>Motivo</TH>
                    <TH align="right">Fecha</TH>
                  </tr>
                </THead>
                <TBody>
                  {txsQ.data.data.map((tx, i) => (
                    <TxRow key={tx.id} tx={tx} index={i} />
                  ))}
                </TBody>
              </Table>
            )}
          </div>
        </section>
      </div>

      {modal && actor && targetUserRow && (
        <LoadUnloadModal
          mode={modal}
          open={!!modal}
          onOpenChange={(o) => !o && setModal(null)}
          presetTargetUser={targetUserRow}
          actorUserId={actor.id}
        />
      )}

      {targetUserRow && (
        <CorrectionModal
          open={correctionOpen}
          onOpenChange={setCorrectionOpen}
          targetUserId={targetUserRow.id}
          targetUsername={targetUserRow.username}
        />
      )}

      {targetUserRow && capQ.data && (
        <EditCorrectionCapModal
          open={capOpen}
          onOpenChange={setCapOpen}
          userId={targetUserRow.id}
          username={targetUserRow.username}
          currentCap={capQ.data.cap}
        />
      )}
    </>
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
  const sign = isCredit ? '+' : '−';
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
            isCredit ? 'text-[var(--color-success)]' : 'text-[var(--color-accent-text)]',
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
          {tx.reason ?? '—'}
        </span>
      </TD>
      <TD numeric className="text-[var(--color-fg-subtle)]">
        {formatDateTime(tx.createdAt)}
      </TD>
    </TR>
  );
}

function Avatar({ name, size = 'md' }: { name: string; size?: 'md' | 'lg' }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const sizeClass = size === 'lg' ? 'size-12 text-[13px]' : 'size-8 text-[11px]';
  return (
    <div
      className={cn(
        'border border-[var(--color-border-strong)] bg-[var(--color-bg-subtle)] flex items-center justify-center font-mono uppercase shrink-0 text-[var(--color-fg-muted)]',
        sizeClass,
      )}
    >
      {initials || '?'}
    </div>
  );
}

function Meta({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span>{label}</span>
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
        {total === 0 ? '—' : `${start}–${end}`}
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
        <Skeleton key={i} className="h-9 w-full bg-[var(--color-bg-subtle)]" />
      ))}
    </div>
  );
}

function formatBalance(balance: string): string {
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
