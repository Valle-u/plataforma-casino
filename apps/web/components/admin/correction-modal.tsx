/**
 * CorrectionModal — carga por corrección/bonificación/reintegro (docs/19).
 *
 * El empleado (con permiso wallet.correct y cupo mensual > 0) carga fichas a un
 * cliente por un motivo operativo. Las fichas salen de la Casa. El cupo del
 * mes limita cuánto puede mover. Todo auditado severity high.
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Info, Wallet } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { ChipsAmountInput } from '@/components/ui/chips-amount-input';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { UserSelect } from '@/components/ui/user-select';
import { isApiError } from '@/lib/api-client';
import {
  useApplyCorrection,
  useCorrectionStatus,
  type CorrectionReasonType,
} from '@/lib/hooks/use-correction';
import { useAuth } from '@/lib/auth-context';
import { type TenantUserRow } from '@/lib/hooks/use-users';

const REASON_OPTIONS: Array<{ value: CorrectionReasonType; label: string }> = [
  { value: 'correction', label: 'Corrección por error de plataforma' },
  { value: 'bonus', label: 'Bonificación / cortesía' },
  { value: 'refund', label: 'Reintegro por retiro no procesado' },
  { value: 'other', label: 'Otro (texto libre obligatorio)' },
];

const schema = z
  .object({
    amount: z
      .string()
      .min(1, 'Requerido.')
      .regex(
        /^(?!0+(?:\.0+)?$)\d+(?:\.\d{1,2})?$/,
        'Monto > 0 con hasta 2 decimales.',
      ),
    reasonType: z.enum(['correction', 'bonus', 'refund', 'other']),
    reasonNotes: z.string().max(500).optional().or(z.literal('')),
  })
  .refine(
    (data) => data.reasonType !== 'other' || !!data.reasonNotes?.trim(),
    { path: ['reasonNotes'], message: 'Motivo "otro" exige texto libre.' },
  );

type FormValues = z.infer<typeof schema>;

interface CorrectionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** El cliente al que se le va a cargar. */
  targetUserId?: string;
  targetUsername?: string;
  /** Nombre para mostrar (si viene de la lista). */
  targetDisplayName?: string;
  /** Callback después de una operación exitosa (ej: refetch de la lista). */
  onSuccess?: () => void;
}

export function CorrectionModal({
  open,
  onOpenChange,
  targetUserId,
  targetUsername,
  targetDisplayName,
  onSuccess,
}: CorrectionModalProps) {
  const { user: actor } = useAuth();
  const status = useCorrectionStatus(open);
  const apply = useApplyCorrection();
  const [selectedTarget, setSelectedTarget] = useState<TenantUserRow | null>(
    targetUserId && targetUsername
      ? { id: targetUserId, username: targetUsername, displayName: targetDisplayName || targetUsername, email: null, status: 'active', createdAt: '', lastLoginAt: null, roleCodes: [], parentUserId: null, parentUsername: null, walletBalance: null, bonusBalance: null, isIndependentBranch: false, underIndependentBranch: false }
      : null,
  );

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { amount: '', reasonType: 'correction', reasonNotes: '' },
  });

  const reasonType = watch('reasonType');

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      reset();
      if (!targetUserId) setSelectedTarget(null);
    }
    onOpenChange(next);
  };

  const effectiveTargetId = targetUserId ?? selectedTarget?.id;
  const effectiveTargetUsername = targetUsername ?? selectedTarget?.username;

  const onSubmit = handleSubmit(async (values) => {
    if (!effectiveTargetId) {
      toast.error('Seleccioná el usuario destino');
      return;
    }
    try {
      const res = await apply.mutateAsync({
        targetUserId: effectiveTargetId,
        amount: values.amount,
        reasonType: values.reasonType,
        reasonNotes: values.reasonNotes?.trim() || undefined,
      });
      toast.success('Carga aplicada', {
        description: `+${fmt(res.transaction.amount)} fichas a ${effectiveTargetUsername}. Cupo restante: ${fmt(res.status.remaining)}.`,
      });
      reset();
      handleOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast.error('No se pudo aplicar la carga', {
        description: mapError(err),
      });
    }
  });

  const capBlocked =
    !!status.data && Number(status.data.remaining) <= 0;

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title="Carga por corrección"
      description={
        targetUsername
          ? `A ${targetDisplayName || targetUsername}. Las fichas salen de la Casa. Motivo obligatorio (auditoría).`
          : 'Seleccioná el cliente destino. Las fichas salen de la Casa. Motivo obligatorio (auditoría).'
      }
      size="lg"
      footer={
        <>
          <Button
            variant="secondary"
            size="md"
            type="button"
            onClick={() => handleOpenChange(false)}
            disabled={apply.isPending}
          >
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="md"
            type="submit"
            form="correction-form"
            disabled={apply.isPending || capBlocked || (!targetUserId && !selectedTarget)}
          >
            {apply.isPending ? (
              <>
                <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                Aplicando…
              </>
            ) : (
              <>
                <Wallet className="size-3.5" />
                Aplicar carga
              </>
            )}
          </Button>
        </>
      }
    >
      <form
        id="correction-form"
        onSubmit={onSubmit}
        className="flex flex-col gap-5"
        noValidate
      >
        {/* Cupo restante — indicador arriba del form */}
        <div className="flex items-start gap-3 px-3 py-2.5 border border-[var(--color-border)] bg-[var(--color-bg)] border-l-2 border-l-[var(--color-accent)]">
          <Info className="size-4 text-[var(--color-accent-text)] mt-0.5 shrink-0" />
          <div className="flex flex-col gap-1 flex-1 text-[12px] text-[var(--color-fg)]">
            {status.isLoading ? (
              <Skeleton className="h-4 w-40" />
            ) : status.isError || !status.data ? (
              <span>No se pudo cargar el cupo.</span>
            ) : (
              <>
                <span>
                  <strong>Cupo del mes:</strong> {fmt(status.data.cap)} fichas.
                </span>
                <span>
                  Usado: {fmt(status.data.used)} · Restante:{' '}
                  <strong>{fmt(status.data.remaining)}</strong>
                </span>
                {capBlocked && (
                  <span className="text-[var(--color-warning)]">
                    Cupo agotado hasta el 1° del mes próximo.
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        {/* Target user selector — solo si no hay preset */}
        {!targetUserId && (
          <FormField
            id="cor-target"
            label="Usuario destinatario"
            required
            hint={
              selectedTarget
                ? `${selectedTarget.displayName || selectedTarget.username}`
                : 'Buscá por username, nombre o email'
            }
          >
            <UserSelect
              value={selectedTarget}
              onSelect={setSelectedTarget}
              excludeUserId={actor?.id}
              disabled={false}
            />
          </FormField>
        )}

        <FormField
          id="cor-amount"
          label="Monto"
          required
          error={errors.amount?.message}
          hint="Hasta 2 decimales."
        >
          <ChipsAmountInput
            id="cor-amount"
            placeholder="0.00"
            invalid={!!errors.amount}
            {...register('amount')}
          />
        </FormField>

        <FormField
          id="cor-reasonType"
          label="Motivo"
          required
          error={errors.reasonType?.message}
          hint="Queda en el audit log permanente."
        >
          <select
            id="cor-reasonType"
            {...register('reasonType')}
            className="h-9 w-full px-2 bg-[var(--color-bg-subtle)] border border-[var(--color-border)] text-[12px] text-[var(--color-fg)] focus:outline-none focus:border-[var(--color-accent)]"
          >
            {REASON_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </FormField>

        <FormField
          id="cor-reasonNotes"
          label="Detalle del motivo"
          required={reasonType === 'other'}
          error={errors.reasonNotes?.message}
          hint={
            reasonType === 'other'
              ? 'Obligatorio cuando el motivo es "Otro".'
              : 'Opcional. Contexto adicional del ajuste.'
          }
        >
          <Input
            id="cor-reasonNotes"
            type="text"
            invalid={!!errors.reasonNotes}
            placeholder="Ej: Reintegro por retiro fallido del 12/07."
            {...register('reasonNotes')}
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
  if (err.status === 403) {
    if (err.code === 'NO_CAP_CONFIGURED')
      return 'No tenés cupo configurado. Pedí al admin que te asigne uno.';
    return 'No tenés permiso para esta operación.';
  }
  if (err.status === 409) {
    if (err.code === 'EMPLOYEE_CAP_EXCEEDED') {
      const e = err as unknown as { remaining?: string; requested?: string };
      return `Excede tu cupo del mes. Restante: ${e.remaining ?? '?'}, se pedía: ${e.requested ?? '?'}.`;
    }
    return err.message || 'Conflicto al procesar.';
  }
  if (err.status === 400) return err.message || 'Datos inválidos.';
  return err.message || 'Error inesperado.';
}
