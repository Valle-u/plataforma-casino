/**
 * BankTxCardList — listado de transferencias mobile-first (Sprint 56).
 *
 * En viewports < lg la tabla densa se reemplaza por tarjetas apiladas,
 * siguiendo el mismo patrón que DepositCardList / WithdrawalCardList:
 *   - Monto grande (+/− según dirección) y moneda.
 *   - Chip de dirección (Entrante/Saliente) + fecha/hora del comprobante.
 *   - Cuenta propia (banco · titular) y contraparte.
 *   - Estado + acciones editar/borrar con tap targets >= 44px.
 *
 * Desktop NO cambia: la tabla sigue en lg+.
 */
'use client';

import { ArrowDownLeft, ArrowUpRight, Link2, Pencil, Trash2 } from 'lucide-react';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { cn } from '@/lib/cn';
import type {
  BankTransaction,
  BankTxDirection,
  BankTxStatus,
} from '@/lib/hooks/use-bank-transactions';

interface BankTxCardListProps {
  rows: BankTransaction[];
  canEdit: boolean;
  canDelete: boolean;
  canMatch: boolean;
  onEdit: (tx: BankTransaction) => void;
  onDelete: (tx: BankTransaction) => void;
  onMatchManual: (tx: BankTransaction) => void;
}

export function BankTxCardList({
  rows,
  canEdit,
  canDelete,
  canMatch,
  onEdit,
  onDelete,
  onMatchManual,
}: BankTxCardListProps) {
  const showActions = canEdit || canDelete || canMatch;

  return (
    <div className="flex flex-col gap-3">
      {rows.map((r) => (
        <BankTxCard
          key={r.id}
          tx={r}
          showActions={showActions}
          canEdit={canEdit}
          canDelete={canDelete}
          canMatch={canMatch}
          onEdit={() => onEdit(r)}
          onDelete={() => onDelete(r)}
          onMatchManual={() => onMatchManual(r)}
        />
      ))}
    </div>
  );
}

const DIRECTION_META: Record<
  BankTxDirection,
  { label: string; variant: BadgeVariant; Icon: typeof ArrowDownLeft }
> = {
  incoming: { label: 'Entrante', variant: 'success', Icon: ArrowDownLeft },
  outgoing: { label: 'Saliente', variant: 'warning', Icon: ArrowUpRight },
};

const STATUS_VARIANT: Record<BankTxStatus, BadgeVariant> = {
  unmatched: 'neutral',
  matched: 'success',
  disputed: 'warning',
};

function BankTxCard({
  tx,
  showActions,
  canEdit,
  canDelete,
  canMatch,
  onEdit,
  onDelete,
  onMatchManual,
}: {
  tx: BankTransaction;
  showActions: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canMatch: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMatchManual: () => void;
}) {
  const { label: dirLabel, variant: dirVariant, Icon } = DIRECTION_META[tx.direction];

  return (
    <article className="flex flex-col gap-3 p-4 bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
      {/* Dirección + fecha/hora del comprobante */}
      <div className="flex items-center justify-between gap-2">
        <Badge variant={dirVariant}>
          <Icon className="size-3" />
          {dirLabel}
        </Badge>
        <span className="text-[10px] text-[var(--color-fg-subtle)] font-mono tabular-nums">
          {formatDateTime(tx.receivedAt)}
        </span>
      </div>

      {/* Monto */}
      <div className="flex items-baseline gap-2">
        <span
          className={cn(
            'font-display text-3xl tracking-tight tabular-nums',
            tx.direction === 'outgoing' && 'text-[var(--color-fg-muted)]',
          )}
        >
          {tx.direction === 'outgoing' ? '−' : '+'}
          {tx.amount}
        </span>
        <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
          {tx.currency}
        </span>
      </div>

      {/* Cuenta propia + contraparte */}
      <div className="flex flex-col gap-1 text-[12px]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] shrink-0">
            {tx.direction === 'outgoing' ? 'Desde' : 'Hacia'}
          </span>
          <span className="text-[var(--color-fg)] truncate">
            {tx.bankName ? (
              <>
                {tx.bankName}
                {tx.accountHolder && (
                  <span className="text-[var(--color-fg-muted)]"> · {tx.accountHolder}</span>
                )}
              </>
            ) : (
              <span className="font-mono text-[var(--color-fg-muted)]">
                {tx.bankAccount ?? '—'}
              </span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] shrink-0">
            {tx.direction === 'outgoing' ? 'Hacia' : 'Desde'}
          </span>
          <span className="text-[var(--color-fg)] truncate">{tx.senderName ?? '—'}</span>
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] shrink-0">
            Subida
          </span>
          <span className="text-[11px] font-mono text-[var(--color-fg-muted)] truncate">
            @{tx.uploaderUsername ?? '?'}
          </span>
        </div>
      </div>

      {/* Estado + acciones */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-[var(--color-border)]">
        <Badge variant={STATUS_VARIANT[tx.status]}>
          {tx.status === 'unmatched'
            ? 'Sin matchear'
            : tx.status === 'matched'
              ? 'Matcheada'
              : 'En disputa'}
        </Badge>
        {showActions && tx.status !== 'matched' ? (
          <div className="flex items-center gap-2">
            {canMatch && (
              <button
                type="button"
                onClick={onMatchManual}
                aria-label="Conciliar con carga/retiro manual"
                className="h-11 px-3 flex items-center gap-1.5 text-[11px] uppercase tracking-[0.08em] font-medium bg-[var(--color-bg-subtle)] text-[var(--color-fg-muted)] border border-[var(--color-border)] hover:text-[var(--color-accent-text)] hover:border-[var(--color-accent)] active:scale-[0.98] transition-colors"
              >
                <Link2 className="size-3.5" />
                Conciliar
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                onClick={onEdit}
                aria-label="Editar transferencia"
                className="h-11 px-3 flex items-center gap-1.5 text-[11px] uppercase tracking-[0.08em] font-medium bg-[var(--color-bg-subtle)] text-[var(--color-fg-muted)] border border-[var(--color-border)] hover:text-[var(--color-fg)] hover:border-[var(--color-border-strong)] active:scale-[0.98] transition-colors"
              >
                <Pencil className="size-3.5" />
                Editar
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                onClick={onDelete}
                aria-label="Borrar transferencia"
                className="h-11 px-3 flex items-center gap-1.5 text-[11px] uppercase tracking-[0.08em] font-medium bg-[var(--color-bg-subtle)] text-[var(--color-fg-muted)] border border-[var(--color-border)] hover:text-[var(--color-danger)] hover:border-[var(--color-danger)] active:scale-[0.98] transition-colors"
              >
                <Trash2 className="size-3.5" />
                Borrar
              </button>
            )}
          </div>
        ) : (
          <span className="text-[11px] text-[var(--color-fg-subtle)]">
            {tx.status === 'matched' ? '—' : ''}
          </span>
        )}
      </div>
    </article>
  );
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
