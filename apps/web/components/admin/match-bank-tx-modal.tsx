/**
 * MatchBankTxModal — modal para matchear un depósito con una transferencia
 * bancaria sin matchear (Sprint 50).
 *
 * Extraído del page /deposits (Sprint 55.x) para reuso desde la card list
 * mobile y el drawer. Muestra transferencias disponibles por monto exacto
 * y permite seleccionar una. Usa Modal (Radix Portal) para renderizar
 * correctamente fuera de la tabla.
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
  useMatchBankTransaction,
  useUnmatchedForAmount,
  type BankTransaction,
} from '@/lib/hooks/use-bank-transactions';
import type { DepositRow } from '@/lib/hooks/use-deposits';

interface MatchBankTxModalProps {
  deposit: DepositRow;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function MatchBankTxModal({
  deposit,
  open,
  onOpenChange,
}: MatchBankTxModalProps) {
  const matchBankTx = useMatchBankTransaction();
  const [includeAll, setIncludeAll] = useState(false);

  const { data: unmatchedRes, isLoading } = useUnmatchedForAmount(
    deposit.amountChips,
    includeAll,
    'incoming',
    // Fase B: mientras el modal está abierto, refetch cada 10s para que la
    // transferencia aparezca "en el momento" sin que el cajero recargue.
    { refetchInterval: open ? 10_000 : false },
  );
  const candidates = unmatchedRes?.data ?? [];

  const handleMatch = async (bankTx: BankTransaction) => {
    try {
      await matchBankTx.mutateAsync({
        bankTxId: bankTx.id,
        depositId: deposit.id,
      });
      toast.success('Transferencia matcheada', {
        description: `$${bankTx.amount} de ${bankTx.senderName ?? 'desconocido'}`,
      });
      onOpenChange(false);
    } catch (err) {
      toast.error('No se pudo matchear', {
        description: isApiError(err) ? err.message : 'Error de conexión.',
      });
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Matchear transferencia"
      description={`Buscando transferencias entrantes de $${deposit.amountChips} ${deposit.currencyFiat}`}
      size="md"
      footer={
        <Button
          variant="secondary"
          size="md"
          onClick={() => onOpenChange(false)}
        >
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
              Sin transferencias para ${deposit.amountChips}
            </span>
            <span className="text-[11px] text-[var(--color-fg-muted)]">
              No hay transferencias entrantes sin matchear con este monto exacto.
            </span>
          </div>
          <label className="flex items-center gap-2 text-[11px] text-[var(--color-fg-muted)] cursor-pointer">
            <input
              type="checkbox"
              checked={includeAll}
              onChange={(e) => setIncludeAll(e.target.checked)}
              className="accent-[var(--color-accent)]"
            />
            Mostrar todas las sin matchear
          </label>
        </div>
      ) : candidates.length === 1 ? (
        // Fase B: un único candidato → sugerencia destacada, no match
        // silencioso. El cajero lo confirma con un click.
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-fg-muted)] font-medium">
              Coincidencia encontrada
            </span>
            <span className="text-[10px] px-1.5 py-0.5 bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)] border border-[var(--color-accent)] font-medium">
              Sugerida
            </span>
          </div>
          <div className="flex flex-col gap-2 p-3 bg-[var(--color-accent-subtle)] border border-[var(--color-accent)]">
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-[15px] text-[var(--color-fg)] font-semibold">
                  ${candidates[0]!.amount} {candidates[0]!.currency ?? 'ARS'}
                </span>
                <span className="text-[11px] text-[var(--color-fg-muted)]">
                  {candidates[0]!.senderName ?? 'Sin nombre'}
                  {candidates[0]!.bankName ? (
                    <>
                      {' '}
                      · {candidates[0]!.bankName}
                      {candidates[0]!.accountHolder
                        ? ` · ${candidates[0]!.accountHolder}`
                        : ''}
                    </>
                  ) : candidates[0]!.bankAccount ? (
                    <>
                      {' '}
                      · Cuenta {candidates[0]!.bankAccount}
                    </>
                  ) : null}
                </span>
                <span className="text-[10px] text-[var(--color-fg-subtle)]">
                  Recibido {formatDateTime(candidates[0]!.receivedAt)} · #
                  {candidates[0]!.id.slice(0, 8)}
                </span>
              </div>
              <Button
                variant="primary"
                size="md"
                onClick={() => handleMatch(candidates[0]!)}
                disabled={matchBankTx.isPending}
              >
                <Link2 className="size-3.5" />
                {matchBankTx.isPending ? 'Matcheando...' : 'Matchear'}
              </Button>
            </div>
          </div>
          <label className="flex items-center gap-1.5 text-[10px] text-[var(--color-fg-muted)] cursor-pointer">
            <input
              type="checkbox"
              checked={includeAll}
              onChange={(e) => setIncludeAll(e.target.checked)}
              className="accent-[var(--color-accent)] size-3"
            />
            Mostrar todas las sin matchear
          </label>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-fg-muted)] font-medium">
              Transferencias disponibles ({candidates.length})
            </span>
            <label className="flex items-center gap-1.5 text-[10px] text-[var(--color-fg-muted)] cursor-pointer">
              <input
                type="checkbox"
                checked={includeAll}
                onChange={(e) => setIncludeAll(e.target.checked)}
                className="accent-[var(--color-accent)] size-3"
              />
              Todas
            </label>
          </div>
          {candidates.map((bt) => (
            <button
              key={bt.id}
              type="button"
              onClick={() => handleMatch(bt)}
              disabled={matchBankTx.isPending}
              className="flex items-center justify-between w-full px-3 py-2.5 bg-[var(--color-bg-subtle)] border border-[var(--color-border)] hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)] transition-colors text-left disabled:opacity-50"
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px] text-[var(--color-fg)] font-medium">
                  ${bt.amount} {bt.currency ?? 'ARS'}
                </span>
                <span className="text-[11px] text-[var(--color-fg-muted)]">
                  {bt.senderName ?? 'Sin nombre'}
                  {bt.bankName ? (
                    <>
                      {' '}
                      · {bt.bankName}
                      {bt.accountHolder ? ` · ${bt.accountHolder}` : ''}
                    </>
                  ) : bt.bankAccount ? (
                    <> · Cuenta {bt.bankAccount}</>
                  ) : null}
                </span>
                <span className="text-[10px] text-[var(--color-fg-subtle)]">
                  Recibido {formatDateTime(bt.receivedAt)} · #{bt.id.slice(0, 8)}
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
