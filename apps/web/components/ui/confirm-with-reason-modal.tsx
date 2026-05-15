/**
 * ConfirmWithReasonModal — modal genérico para acciones destructivas que
 * exigen un motivo (e.g. rechazar depósito, cancelar bono, suspender user).
 *
 * El motivo va al audit log y se muestra al usuario afectado, así que se
 * pide explícito antes de confirmar.
 *
 * UX:
 *   - Banner warning rojo arriba.
 *   - Textarea para reason con counter de chars.
 *   - Botón confirm con variant `danger` + spinner durante mutation.
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ShieldAlert } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { z as Z } from 'zod';
import { Button } from './button';
import { FormField } from './form-field';
import { Modal } from './modal';
import { cn } from '@/lib/cn';

const schema = z.object({
  reason: Z.string()
    .min(3, 'Mínimo 3 caracteres.')
    .max(500, 'Máximo 500 caracteres.'),
});

type FormValues = z.infer<typeof schema>;

interface ConfirmWithReasonModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** Texto del banner de warning. */
  warning: string;
  /** Texto del CTA de confirmar (default: "Confirmar"). */
  confirmLabel?: string;
  /** Icon opcional para el botón de confirmar. */
  confirmIcon?: ReactNode;
  /** Placeholder del textarea de reason. */
  reasonPlaceholder?: string;
  /** Hint debajo del textarea. */
  reasonHint?: string;
  /** Callback async — recibe el reason validado. */
  onConfirm: (reason: string) => Promise<void> | void;
  /** Loading state externo (deshabilita confirmar + spinner). */
  isPending?: boolean;
}

export function ConfirmWithReasonModal({
  open,
  onOpenChange,
  title,
  description,
  warning,
  confirmLabel = 'Confirmar',
  confirmIcon,
  reasonPlaceholder,
  reasonHint = 'Texto libre. Queda en audit log permanente y puede mostrarse al usuario.',
  onConfirm,
  isPending,
}: ConfirmWithReasonModalProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { reason: '' },
  });

  const reasonValue = watch('reason') ?? '';

  // Reset al cerrar.
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const onSubmit = handleSubmit(async (values) => {
    await onConfirm(values.reason);
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
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
            variant="danger"
            size="md"
            type="submit"
            form="confirm-reason-form"
            disabled={isPending}
          >
            {isPending ? (
              <>
                <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                Procesando…
              </>
            ) : (
              <>
                {confirmIcon}
                {confirmLabel}
              </>
            )}
          </Button>
        </>
      }
    >
      <form
        id="confirm-reason-form"
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
        noValidate
      >
        <div className="flex items-start gap-3 px-3 py-2.5 border border-[var(--color-accent-border)] bg-[var(--color-accent-subtle)] border-l-2 border-l-[var(--color-accent)]">
          <ShieldAlert className="size-4 text-[var(--color-accent)] mt-0.5 shrink-0" />
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-accent)] font-medium">
              Acción crítica
            </span>
            <span className="text-[12px] text-[var(--color-fg)]">{warning}</span>
          </div>
        </div>

        <FormField
          id="cwr-reason"
          label="Motivo"
          required
          error={errors.reason?.message}
          hint={reasonHint}
        >
          <textarea
            id="cwr-reason"
            rows={4}
            aria-invalid={!!errors.reason}
            placeholder={reasonPlaceholder}
            className={cn(
              'flex w-full px-3 py-2 resize-none',
              'bg-[var(--color-bg-subtle)] text-[var(--color-fg)]',
              'border border-[var(--color-border)]',
              'placeholder:text-[var(--color-fg-subtle)]',
              'text-[13px] leading-relaxed',
              'transition-[border-color,box-shadow] duration-150',
              'hover:border-[var(--color-border-strong)]',
              'focus:outline-none focus:border-[var(--color-accent)]',
              'focus:shadow-[0_0_0_3px_var(--color-accent-glow)]',
              'aria-invalid:border-[var(--color-accent)]',
              'aria-invalid:shadow-[0_0_0_3px_var(--color-accent-glow)]',
            )}
            {...register('reason')}
          />
          <div className="flex justify-end">
            <span
              className={cn(
                'text-[10px] font-mono tabular-nums',
                reasonValue.length > 450
                  ? 'text-[var(--color-accent)]'
                  : 'text-[var(--color-fg-subtle)]',
              )}
            >
              {reasonValue.length}/500
            </span>
          </div>
        </FormField>
      </form>
    </Modal>
  );
}
