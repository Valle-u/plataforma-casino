/**
 * MarkPaidModal — confirmar pago de un withdrawal con externalRef.
 *
 * Diferencia con ConfirmWithReasonModal: acá pedimos externalRef
 * (referencia bancaria de la transferencia ejecutada) en lugar de un
 * motivo. notes opcional. La operación NO es destructiva sino positiva
 * (el dinero salió y se registra), así que el botón confirm va con
 * variant primary.
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, Send } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/lib/cn';

const schema = z.object({
  externalRef: z
    .string()
    .min(3, 'Mínimo 3 caracteres.')
    .max(200, 'Máximo 200 caracteres.'),
  notes: z.string().max(500).optional().or(z.literal('')),
});

type FormValues = z.infer<typeof schema>;

interface MarkPaidModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Monto del retiro para mostrar en el header del modal. */
  amount: string;
  currency?: string;
  onConfirm: (payload: { externalRef: string; notes?: string }) => Promise<void> | void;
  isPending?: boolean;
}

export function MarkPaidModal({
  open,
  onOpenChange,
  amount,
  currency = 'FICHAS',
  onConfirm,
  isPending,
}: MarkPaidModalProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { externalRef: '', notes: '' },
  });

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const onSubmit = handleSubmit(async (values) => {
    await onConfirm({
      externalRef: values.externalRef,
      notes: values.notes || undefined,
    });
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Marcar como pagado"
      description="Confirma que la transferencia bancaria ya se ejecutó y registra la referencia."
      size="md"
      footer={
        <>
          <Button
            variant="secondary"
            size="md"
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="md"
            type="submit"
            form="mark-paid-form"
            disabled={isPending}
            className={cn(
              'bg-[var(--color-success)] hover:bg-[#166534] border-[var(--color-success)]',
            )}
          >
            {isPending ? (
              <>
                <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                Marcando…
              </>
            ) : (
              <>
                <CheckCircle2 className="size-3.5" />
                Confirmar pago
              </>
            )}
          </Button>
        </>
      }
    >
      <form
        id="mark-paid-form"
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
        noValidate
      >
        {/* Resumen del monto */}
        <div className="flex items-center gap-3 px-4 py-3 bg-[var(--color-bg)] border border-[var(--color-border)]">
          <Send className="size-4 text-[var(--color-success)] shrink-0" />
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)]">
              Vas a confirmar el pago de
            </span>
            <span className="font-mono text-[15px] tabular-nums text-[var(--color-fg)]">
              {amount}{' '}
              <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
                {currency}
              </span>
            </span>
          </div>
        </div>

        <FormField
          id="mp-externalRef"
          label="Referencia bancaria"
          required
          error={errors.externalRef?.message}
          hint="N° de operación, hash crypto, ID de transferencia, etc."
        >
          <Input
            id="mp-externalRef"
            type="text"
            invalid={!!errors.externalRef}
            placeholder="Ej: TX-2026-0515-007842"
            className="font-mono"
            {...register('externalRef')}
          />
        </FormField>

        <FormField
          id="mp-notes"
          label="Notas"
          error={errors.notes?.message}
          hint="Opcional. Detalle interno (no se muestra al usuario)."
        >
          <Input
            id="mp-notes"
            type="text"
            invalid={!!errors.notes}
            {...register('notes')}
          />
        </FormField>
      </form>
    </Modal>
  );
}
