/**
 * SettleNetworkModal — liquida las comisiones de socios de un período (C3).
 *
 * La comisión al socio se paga SIEMPRE en PLATA REAL: la Casa quema el
 * equivalente en fichas y el socio cobra por fuera. El socio dependiente no
 * maneja fichas (sus cargas/retiros van por la tesorería y el banco del
 * tenant — docs/20). Requiere `commissions.settle`.
 */

'use client';

import { Check, Info } from 'lucide-react';
import { useRef } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
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
  // Input NO controlado (ref): tipear no re-renderiza el modal (evita perder el
  // foco en Opera). El valor se lee al confirmar.
  const referenceRef = useRef<HTMLInputElement>(null);

  async function handleConfirm(): Promise<void> {
    try {
      const res = await settle.mutateAsync({
        period,
        reference: referenceRef.current?.value || undefined,
      });
      if (res.failed > 0) {
        toast.warning(`Liquidados ${res.settled}, fallaron ${res.failed}`, {
          description: 'Revisá que la Casa tenga saldo suficiente.',
        });
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
                Liquidar en plata real
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
            La comisión se paga en <strong>plata real</strong> por fuera de la
            plataforma. La Casa <strong>quema</strong> el equivalente en fichas
            (mantiene 1 ficha = 1 peso). El socio dependiente no recibe fichas:
            sus cargas y retiros van por la tesorería y el banco del tenant.
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
            ref={referenceRef}
            defaultValue=""
            placeholder="Ej: TRANSFER-2026-06-001"
          />
        </FormField>
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
