/**
 * InjectCapitalModal — aporte de capital del dueño a la Casa (Parte B, B-build-3).
 *
 * El dueño elige una transferencia bancaria ENTRANTE sin matchear (su plata a la
 * caja) y se mintea ese monto a la Casa. El monto sale del bank_tx (1 ficha =
 * 1 peso). Requiere permiso `house.inject_capital`.
 */

'use client';

import { Info, Landmark, Sprout } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiError } from '@/lib/api-client';
import { useBankTransactions } from '@/lib/hooks/use-bank-transactions';
import { useInjectCapital } from '@/lib/hooks/use-house';
import { cn } from '@/lib/cn';

function fmt(x: string): string {
  const n = Number(x);
  return Number.isFinite(n)
    ? n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : x;
}

function fmtDate(x: string): string {
  return new Date(x).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface InjectCapitalModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InjectCapitalModal({ open, onOpenChange }: InjectCapitalModalProps) {
  const transfers = useBankTransactions({
    status: 'unmatched',
    direction: 'incoming',
    limit: 50,
  });
  const inject = useInjectCapital();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!open) {
      setSelectedId(null);
      setNotes('');
    }
  }, [open]);

  const rows = transfers.data?.data ?? [];
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  async function handleSubmit(): Promise<void> {
    if (!selectedId) return;
    try {
      const res = await inject.mutateAsync({
        bankTransactionId: selectedId,
        notes: notes.trim() || undefined,
      });
      toast.success('Capital aportado a la Casa', {
        description: `+${fmt(res.amount)} fichas. La Casa ahora tiene con qué operar.`,
      });
      onOpenChange(false);
    } catch (err) {
      toast.error('No se pudo aportar el capital', { description: mapError(err) });
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Aportar capital a la Casa"
      description="Elegí la transferencia ENTRANTE (tu plata a la caja) que respalda el aporte. Se mintea ese monto a la Casa."
      size="lg"
      footer={
        <>
          <Button
            variant="secondary"
            size="md"
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={inject.isPending}
          >
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="md"
            type="button"
            onClick={handleSubmit}
            disabled={!selectedId || inject.isPending}
          >
            {inject.isPending ? (
              <>
                <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                Aportando…
              </>
            ) : (
              <>
                <Sprout className="size-3.5" />
                Aportar{selected ? ` ${fmt(selected.amount)}` : ''}
              </>
            )}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3 px-3 py-2.5 border border-[var(--color-border)] bg-[var(--color-bg)] border-l-2 border-l-[var(--color-accent)]">
          <Info className="size-4 text-[var(--color-accent-text)] mt-0.5 shrink-0" />
          <span className="text-[12px] text-[var(--color-fg)] leading-snug">
            Se mintea a la Casa <strong>exactamente el monto de la transferencia</strong>{' '}
            (1 ficha = 1 peso). Es la única forma de crear fichas, y queda
            respaldada por esa transferencia. Solo aparecen las{' '}
            <strong>entrantes sin matchear</strong>.
          </span>
        </div>

        <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] font-medium">
          Transferencia que respalda el aporte
        </span>

        {transfers.isLoading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            hint="data"
            label="No hay transferencias entrantes sin matchear. Cargalas primero en Transferencias y volvé."
          />
        ) : (
          <div className="flex flex-col gap-2 max-h-[320px] overflow-y-auto">
            {rows.map((tx) => {
              const active = selectedId === tx.id;
              return (
                <button
                  key={tx.id}
                  type="button"
                  onClick={() => setSelectedId(tx.id)}
                  className={cn(
                    'text-left border p-3 flex flex-col gap-1 transition-colors',
                    active
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent-subtle)]'
                      : 'border-[var(--color-border)] bg-[var(--color-bg-elevated)] hover:border-[var(--color-border-strong)]',
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono num text-[16px] text-[var(--color-fg)]">
                      {fmt(tx.amount)}{' '}
                      <span className="text-[10px] text-[var(--color-fg-subtle)]">
                        {tx.currency}
                      </span>
                    </span>
                    <span className="text-[11px] text-[var(--color-fg-subtle)] font-mono">
                      {fmtDate(tx.receivedAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[12px] text-[var(--color-fg-muted)]">
                    <Landmark className="size-3 shrink-0" />
                    {tx.senderName ?? 'sin remitente'} · {tx.bankAccount}
                  </div>
                  {tx.reference && (
                    <span className="text-[11px] text-[var(--color-fg-subtle)] truncate">
                      {tx.reference}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] font-medium">
            Notas (opcional)
          </span>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ej: recarga de caja de junio."
            className={cn(
              'flex w-full px-3 py-2 resize-y',
              'bg-[var(--color-bg-subtle)] text-[var(--color-fg)]',
              'border border-[var(--color-border)] text-[12px] leading-relaxed',
              'hover:border-[var(--color-border-strong)]',
              'focus:outline-none focus:border-[var(--color-accent)]',
              'focus:shadow-[0_0_0_3px_var(--color-accent-glow)]',
            )}
          />
        </label>
      </div>
    </Modal>
  );
}

function mapError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.status === 409) return 'Esa transferencia ya está asociada a otra operación.';
  if (err.status === 400) return 'La transferencia debe ser entrante.';
  if (err.status === 403) return 'No tenés permiso para aportar capital.';
  if (err.status === 404) {
    return err.code === 'HOUSE_NOT_PROVISIONED'
      ? 'La Casa no está provisionada en este tenant.'
      : 'La transferencia no existe.';
  }
  return err.message || 'Error inesperado.';
}
