/**
 * MatchManualTxModal — concilia una transferencia bancaria con una CARGA
 * (entrante) o RETIRO (saliente) de fichas MANUAL. Flujo inverso al de
 * depósitos: se abre desde una transferencia sin conciliar y se elige el
 * movimiento manual a vincular.
 */
'use client';

import { ImageOff, Link2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiError } from '@/lib/api-client';
import {
  useMatchBankTransactionManual,
  useUnmatchedManual,
  type BankTransaction,
  type UnmatchedManualRow,
} from '@/lib/hooks/use-bank-transactions';

export function MatchManualTxModal({
  bankTx,
  open,
  onOpenChange,
}: {
  bankTx: BankTransaction;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const match = useMatchBankTransactionManual();
  const [showAll, setShowAll] = useState(false);
  const kind = bankTx.direction === 'incoming' ? 'carga' : 'retiro';

  const { data, isLoading } = useUnmatchedManual(
    bankTx.direction,
    showAll ? undefined : bankTx.amount,
    undefined,
    { enabled: open, refetchInterval: open ? 10_000 : false },
  );
  const candidates = data?.data ?? [];

  const handle = async (row: UnmatchedManualRow) => {
    try {
      await match.mutateAsync({ bankTxId: bankTx.id, walletTxId: row.id });
      toast.success(`Conciliado con ${kind}`, {
        description: `${row.amount} fichas · ${row.ownerDisplayName}`,
      });
      onOpenChange(false);
    } catch (err) {
      toast.error('No se pudo conciliar', {
        description: isApiError(err) ? err.message : 'Error de conexión.',
      });
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Conciliar con ${kind} manual`}
      description={`Transferencia ${
        bankTx.direction === 'incoming' ? 'entrante' : 'saliente'
      } de $${bankTx.amount} ${bankTx.currency ?? 'ARS'}`}
      size="md"
      footer={
        <Button variant="secondary" size="md" onClick={() => onOpenChange(false)}>
          Cerrar
        </Button>
      }
    >
      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full bg-[var(--color-bg-subtle)]" />
          ))}
        </div>
      ) : candidates.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <div className="size-10 rounded-full bg-[var(--color-bg-subtle)] flex items-center justify-center">
            <ImageOff className="size-5 text-[var(--color-fg-subtle)]" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[13px] text-[var(--color-fg)]">
              Sin {kind}s manuales por ${bankTx.amount}
            </span>
            <span className="text-[11px] text-[var(--color-fg-muted)]">
              No hay {kind}s de fichas sin conciliar con ese monto exacto.
            </span>
          </div>
          <label className="flex items-center gap-2 text-[11px] text-[var(--color-fg-muted)] cursor-pointer">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
              className="accent-[var(--color-accent)]"
            />
            Mostrar todas (cualquier monto)
          </label>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-fg-muted)] font-medium">
              {kind === 'carga' ? 'Cargas' : 'Retiros'} sin conciliar ({candidates.length})
            </span>
            <label className="flex items-center gap-1.5 text-[10px] text-[var(--color-fg-muted)] cursor-pointer">
              <input
                type="checkbox"
                checked={showAll}
                onChange={(e) => setShowAll(e.target.checked)}
                className="accent-[var(--color-accent)] size-3"
              />
              Todas
            </label>
          </div>
          {candidates.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => handle(row)}
              disabled={match.isPending}
              className="flex items-center justify-between w-full px-3 py-2.5 bg-[var(--color-bg-subtle)] border border-[var(--color-border)] hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)] transition-colors text-left disabled:opacity-50"
            >
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-[13px] text-[var(--color-fg)] font-medium">
                  {row.amount} fichas
                </span>
                <span className="text-[11px] text-[var(--color-fg-muted)] truncate">
                  {row.ownerDisplayName}
                  <span className="text-[var(--color-fg-subtle)]"> · @{row.ownerUsername}</span>
                </span>
                <span className="text-[10px] text-[var(--color-fg-subtle)] truncate">
                  {formatDateTime(row.createdAt)}
                  {row.reason ? ` · ${row.reason}` : ''} · #{row.id.slice(0, 8)}
                </span>
              </div>
              <Link2 className="size-4 text-[var(--color-accent-text)] shrink-0" />
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-AR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
