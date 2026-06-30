/**
 * SettleNetworkModal — liquida las comisiones de socios de un período (C4).
 *
 * Dos formas: FICHAS (transfer de la Casa al socio) o PLATA REAL (la Casa quema
 * el equivalente en fichas y el socio cobra por transferencia, por fuera).
 * Requiere `commissions.settle`.
 */

'use client';

import { Check, Coins, Flame, Info } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/lib/cn';
import { isApiError } from '@/lib/api-client';
import { useSettleNetwork } from '@/lib/hooks/use-network-commissions';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  period: string;
  pendingCount: number;
  totalPayable: string;
}

function fmt(x: string): string {
  const n = Number(x);
  return Number.isFinite(n)
    ? n.toLocaleString('es-AR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : x;
}

export function SettleNetworkModal({
  open,
  onOpenChange,
  period,
  pendingCount,
  totalPayable,
}: Props) {
  const settle = useSettleNetwork();
  const [method, setMethod] = useState<'chips' | 'cash'>('chips');
  const [reference, setReference] = useState('');

  useEffect(() => {
    if (open) {
      setMethod('chips');
      setReference('');
    }
  }, [open]);

  async function handleConfirm(): Promise<void> {
    try {
      const res = await settle.mutateAsync({
        period,
        method,
        reference: method === 'cash' ? reference || undefined : undefined,
      });
      if (res.failed > 0) {
        toast.warning(
          `Liquidados ${res.settled}, fallaron ${res.failed}`,
          { description: 'Revisá que la Casa tenga saldo suficiente.' },
        );
      } else {
        toast.success(
          `Liquidados ${res.settled} socio(s) — ${fmt(res.totalPaid)} en comisiones`,
        );
      }
      onOpenChange(false);
    } catch (err) {
      toast.error('No se pudo liquidar', { description: mapError(err) });
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Liquidar comisiones · ${period}`}
      description={`${pendingCount} socio(s) pendiente(s) por un total de ${fmt(totalPayable)}.`}
      size="md"
      footer={
        <>
          <Button
            variant="secondary"
            size="md"
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={settle.isPending}
          >
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="md"
            type="button"
            onClick={handleConfirm}
            disabled={settle.isPending || pendingCount === 0}
          >
            {settle.isPending ? (
              <>
                <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                Liquidando…
              </>
            ) : (
              <>
                <Check className="size-3.5" />
                Liquidar {method === 'chips' ? 'en fichas' : 'en plata real'}
              </>
            )}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Selector de forma de pago */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMethod('chips')}
            className={cn(
              'flex flex-col items-start gap-1 p-3 border text-left transition-colors',
              method === 'chips'
                ? 'border-[var(--color-accent)] bg-[var(--color-bg-subtle)]'
                : 'border-[var(--color-border)] hover:bg-[var(--color-bg-subtle)]',
            )}
          >
            <span className="flex items-center gap-1.5 text-[13px] text-[var(--color-fg)]">
              <Coins className="size-3.5 text-[var(--color-accent-text)]" />
              Fichas
            </span>
            <span className="text-[11px] text-[var(--color-fg-subtle)] leading-snug">
              La Casa le transfiere fichas al socio (siguen en la plataforma).
            </span>
          </button>
          <button
            type="button"
            onClick={() => setMethod('cash')}
            className={cn(
              'flex flex-col items-start gap-1 p-3 border text-left transition-colors',
              method === 'cash'
                ? 'border-[var(--color-accent)] bg-[var(--color-bg-subtle)]'
                : 'border-[var(--color-border)] hover:bg-[var(--color-bg-subtle)]',
            )}
          >
            <span className="flex items-center gap-1.5 text-[13px] text-[var(--color-fg)]">
              <Flame className="size-3.5 text-[var(--color-accent-text)]" />
              Plata real
            </span>
            <span className="text-[11px] text-[var(--color-fg-subtle)] leading-snug">
              Pagás por transferencia; la Casa quema las fichas equivalentes.
            </span>
          </button>
        </div>

        {method === 'cash' && (
          <>
            <div className="flex items-start gap-3 px-3 py-2.5 border border-[var(--color-border)] bg-[var(--color-bg)] border-l-2 border-l-[var(--color-accent)]">
              <Info className="size-4 text-[var(--color-accent-text)] mt-0.5 shrink-0" />
              <span className="text-[12px] text-[var(--color-fg)] leading-snug">
                Al pagar en plata real, la plata sale por fuera de la plataforma,
                así que la Casa <strong>quema</strong> el equivalente en fichas
                (mantiene 1 ficha = 1 peso). El socio NO recibe fichas.
              </span>
            </div>
            <FormField
              id="settle-ref"
              label="Comprobante / referencia (opcional)"
              hint="ID o referencia de la transferencia bancaria, para auditoría."
            >
              <Input
                id="settle-ref"
                type="text"
                maxLength={200}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Ej: TRANSFER-2026-06-001"
              />
            </FormField>
          </>
        )}
      </div>
    </Modal>
  );
}

function mapError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.status === 403) return 'No tenés permiso para liquidar comisiones.';
  if (err.code === 'HOUSE_NOT_PROVISIONED')
    return 'La Casa (tesorería) no está provisionada.';
  return err.message || 'Error inesperado.';
}
