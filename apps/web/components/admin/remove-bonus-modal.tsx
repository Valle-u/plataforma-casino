/**
 * RemoveBonusModal — sacar dinero de bono de un jugador (débito manual).
 *
 * Espeja `RemoveBonusDto` del backend:
 *   - userId: target (siempre preset, se muestra read-only).
 *   - amount: positivo, hasta 2 decimales.
 *   - reason: min 10 chars, debe contener letras (anti-abuso del cajero).
 *   - notes: opcional.
 *
 * El reverso vuelve al funder original / Casa (LEYES E3/B4, docs/15 §Reverso).
 * Idempotency-key auto-generada en el hook.
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ShieldAlert, Undo2 } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { ChipsAmountInput } from '@/components/ui/chips-amount-input';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { isApiError } from '@/lib/api-client';
import { useRemoveBonus } from '@/lib/hooks/use-bonuses';
import { type TenantUserRow } from '@/lib/hooks/use-users';

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
    .min(10, 'Mínimo 10 caracteres descriptivos.')
    .max(500, 'Máximo 500 caracteres.')
    .regex(/[a-zA-Z]{3,}/, 'Debe contener al menos 3 letras consecutivas.'),
  notes: z.string().max(1000).optional().or(z.literal('')),
});

type FormValues = z.infer<typeof schema>;

interface RemoveBonusModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Destinatario fijo (viene del row/detalle del user). */
  targetUser: TenantUserRow;
  /** Bonus balance actual del jugador (para mostrar disponibilidad). */
  bonusBalance?: string | null;
}

export function RemoveBonusModal({
  open,
  onOpenChange,
  targetUser,
  bonusBalance,
}: RemoveBonusModalProps) {
  const remove = useRemoveBonus();

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { amount: '', reason: '', notes: '' },
  });

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const onSubmit = handleSubmit(async (values) => {
    try {
      const result = await remove.mutateAsync({
        userId: targetUser.id,
        amount: values.amount,
        reason: values.reason,
        notes: values.notes || undefined,
      });
      toast.success('Dinero de bono sacado', {
        description: `${result.amount} FICHAS → vuelven al funder original / Casa (${targetUser.displayName || targetUser.username}).`,
      });
      handleOpenChange(false);
    } catch (err) {
      toast.error('No se pudo sacar el bono', {
        description: mapServerError(err),
      });
    }
  });

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title="Sacar dinero de bono"
      description={`${targetUser.displayName || targetUser.username} pierde el monto de su wallet de bono. El reverso vuelve al funder original / Casa.`}
      size="lg"
      footer={
        <>
          <Button
            variant="secondary"
            size="md"
            type="button"
            onClick={() => handleOpenChange(false)}
            disabled={remove.isPending}
          >
            Cancelar
          </Button>
          <Button
            variant="danger"
            size="md"
            type="submit"
            form="remove-bonus-form"
            disabled={remove.isPending}
          >
            {remove.isPending ? (
              <>
                <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                Sacando…
              </>
            ) : (
              <>
                <Undo2 className="size-3.5" />
                Sacar bono
              </>
            )}
          </Button>
        </>
      }
    >
      <form
        id="remove-bonus-form"
        onSubmit={onSubmit}
        className="flex flex-col gap-5"
        noValidate
      >
        <div className="flex items-start gap-3 px-3 py-2.5 border border-[var(--color-border)] bg-[var(--color-bg)] border-l-2 border-l-[var(--color-danger)]">
          <ShieldAlert className="size-4 text-[var(--color-danger)] mt-0.5 shrink-0" />
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-danger)] font-medium">
              Audit severity:high
            </span>
            <span className="text-[12px] text-[var(--color-fg)]">
              El monto se debita del bonus_balance y se acredita al funder
              original / Casa. No es una retirada al operador.
            </span>
          </div>
        </div>

        <FormField
          id="rb-target"
          label="Usuario"
          required
          hint={`Bono de ${targetUser.displayName || targetUser.username}`}
        >
          <Input
            id="rb-target"
            type="text"
            value={targetUser.displayName || targetUser.username}
            disabled
          />
        </FormField>

        <FormField
          id="rb-amount"
          label="Monto a sacar"
          required
          error={errors.amount?.message}
          hint={
            bonusBalance !== undefined && bonusBalance !== null
              ? `Disponible en bono: ${bonusBalance} FICHAS`
              : 'El backend valida contra el bonus_balance del jugador.'
          }
        >
          <ChipsAmountInput
            id="rb-amount"
            placeholder="0.00"
            invalid={!!errors.amount}
            {...register('amount')}
          />
        </FormField>

        <FormField
          id="rb-reason"
          label="Motivo"
          required
          error={errors.reason?.message}
          hint="Mínimo 10 caracteres. Texto descriptivo (no 'test', 'abc')."
        >
          <Input
            id="rb-reason"
            type="text"
            invalid={!!errors.reason}
            placeholder="Ej: Error en la carga de bono, se retira el monto otorgado"
            {...register('reason')}
          />
        </FormField>

        <FormField
          id="rb-notes"
          label="Notas"
          error={errors.notes?.message}
          hint="Opcional. Detalle interno (no visible para el user)."
        >
          <Input
            id="rb-notes"
            type="text"
            invalid={!!errors.notes}
            {...register('notes')}
          />
        </FormField>
      </form>
    </Modal>
  );
}

function mapServerError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.status === 409) {
    if (err.code === 'BONUS_INSUFFICIENT_BALANCE') {
      return 'El jugador no tiene saldo de bono suficiente para ese monto.';
    }
    if (err.code === 'IDEMPOTENCY_CONFLICT') {
      return 'Ya existe una operación con esa key. Reintentá.';
    }
    return err.message || 'Conflicto al procesar.';
  }
  if (err.status === 403) {
    if (err.code === 'OUT_OF_SCOPE') {
      return 'El usuario no está dentro de tu red operativa.';
    }
    return 'No tenés permiso para esta operación.';
  }
  if (err.status === 400) {
    if (err.code === 'BONUS_TARGET_NOT_PLAYER') {
      return 'Los bonos son exclusivos de usuarios finales.';
    }
    return err.message || 'Datos inválidos.';
  }
  if (err.status === 429) return 'Demasiadas operaciones en poco tiempo. Esperá un minuto.';
  return err.message || 'Error inesperado.';
}
