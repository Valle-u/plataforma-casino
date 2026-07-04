/**
 * InjectBudgetModal — fondeo de PRESUPUESTO a la Casa (docs/16 §12).
 *
 * A diferencia de InjectCapitalModal (que exige una transferencia bancaria
 * entrante), acá el admin fija el monto y el motivo directo. Modelo "banco
 * central": solo el admin (o quien tenga el permiso delegado) emite el
 * presupuesto, y todo lo demás drena de la Casa.
 *
 * Requiere permiso `house.inject_capital`.
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Info, Wallet } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { ChipsAmountInput } from '@/components/ui/chips-amount-input';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { isApiError } from '@/lib/api-client';
import { newHouseIdempotencyKey, useInjectBudget } from '@/lib/hooks/use-house';

const schema = z.object({
  amount: z
    .string()
    .min(1, 'Requerido.')
    .regex(
      /^(?!0+(?:\.0+)?$)\d+(?:\.\d{1,2})?$/,
      'Monto > 0 con hasta 2 decimales.',
    ),
  reason: z
    .string()
    .min(3, 'Mínimo 3 caracteres.')
    .max(500, 'Máximo 500 caracteres.'),
  notes: z.string().max(1000).optional().or(z.literal('')),
});

type FormValues = z.infer<typeof schema>;

interface InjectBudgetModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InjectBudgetModal({ open, onOpenChange }: InjectBudgetModalProps) {
  const inject = useInjectBudget();
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { amount: '', reason: '', notes: '' },
  });

  /**
   * D5: idempotency key para el submit — generada una sola vez por apertura del
   * modal. Si el request se retryea (timeout, doble click), el resubmit usa la
   * MISMA key y el backend devuelve la injection previa sin doble mint. Se
   * regenera al abrir el modal de nuevo (submits distintos = keys distintas).
   */
  const idempotencyKeyRef = useRef<string>(newHouseIdempotencyKey());
  useEffect(() => {
    if (open) idempotencyKeyRef.current = newHouseIdempotencyKey();
  }, [open]);

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const onSubmit = handleSubmit(async (values) => {
    try {
      const res = await inject.mutateAsync({
        amount: values.amount,
        reason: values.reason,
        notes: values.notes || undefined,
        idempotencyKey: idempotencyKeyRef.current,
      });
      toast.success('Presupuesto fondeado a la Casa', {
        description: `+${fmt(res.amount)} fichas. Motivo: ${res.reason}.`,
      });
      reset();
      handleOpenChange(false);
    } catch (err) {
      toast.error('No se pudo fondear el presupuesto', {
        description: mapError(err),
      });
    }
  });

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title="Fondear presupuesto a la Casa"
      description="Crea fichas en la Casa sin atarlas a una transferencia. Modelo banco central: solo vos emitís el presupuesto; todo lo demás drena de acá."
      size="lg"
      footer={
        <>
          <Button
            variant="secondary"
            size="md"
            type="button"
            onClick={() => handleOpenChange(false)}
            disabled={inject.isPending}
          >
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="md"
            type="submit"
            form="inject-budget-form"
            disabled={inject.isPending}
          >
            {inject.isPending ? (
              <>
                <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                Fondeando…
              </>
            ) : (
              <>
                <Wallet className="size-3.5" />
                Fondear presupuesto
              </>
            )}
          </Button>
        </>
      }
    >
      <form
        id="inject-budget-form"
        onSubmit={onSubmit}
        className="flex flex-col gap-5"
        noValidate
      >
        <div className="flex items-start gap-3 px-3 py-2.5 border border-[var(--color-border)] bg-[var(--color-bg)] border-l-2 border-l-[var(--color-accent)]">
          <Info className="size-4 text-[var(--color-accent-text)] mt-0.5 shrink-0" />
          <span className="text-[12px] text-[var(--color-fg)] leading-snug">
            Este fondeo <strong>NO exige una transferencia bancaria</strong>. Es
            el techo de fichas que la plataforma puede repartir en el período.
            Todo queda <strong>auditado</strong> con motivo obligatorio (severity
            high).
          </span>
        </div>

        <FormField
          id="ib-amount"
          label="Monto"
          required
          error={errors.amount?.message}
          hint="Hasta 2 decimales. Ej: 1000000 (un millón de fichas para el mes)."
        >
          <ChipsAmountInput
            id="ib-amount"
            placeholder="0.00"
            invalid={!!errors.amount}
            {...register('amount')}
          />
        </FormField>

        <FormField
          id="ib-reason"
          label="Motivo"
          required
          error={errors.reason?.message}
          hint="Texto libre. Queda en el audit log permanente."
        >
          <Input
            id="ib-reason"
            type="text"
            invalid={!!errors.reason}
            placeholder="Presupuesto julio 2026"
            {...register('reason')}
          />
        </FormField>

        <FormField
          id="ib-notes"
          label="Notas"
          error={errors.notes?.message}
          hint="Opcional. Detalle interno adicional."
        >
          <Input
            id="ib-notes"
            type="text"
            invalid={!!errors.notes}
            placeholder="Recarga inicial del mes, cierre trimestral, etc."
            {...register('notes')}
          />
        </FormField>
      </form>
    </Modal>
  );
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

function mapError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.status === 403) return 'No tenés permiso para fondear la Casa.';
  if (err.status === 404) {
    return err.code === 'HOUSE_NOT_PROVISIONED'
      ? 'La Casa no está provisionada en este tenant.'
      : err.message || 'No encontrado.';
  }
  if (err.status === 400) return err.message || 'Datos inválidos.';
  return err.message || 'Error inesperado.';
}
