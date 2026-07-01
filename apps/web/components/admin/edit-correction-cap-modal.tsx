/**
 * EditCorrectionCapModal — admin fija el cupo mensual de correcciones de un
 * empleado (docs/19). Cupo 0 = el empleado NO puede aplicar cargas.
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Info, Wallet } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { ChipsAmountInput } from '@/components/ui/chips-amount-input';
import { FormField } from '@/components/ui/form-field';
import { Modal } from '@/components/ui/modal';
import { isApiError } from '@/lib/api-client';
import { useSetCorrectionCap } from '@/lib/hooks/use-correction';

const schema = z.object({
  cap: z
    .string()
    .min(1, 'Requerido.')
    .regex(/^\d+(?:\.\d{1,2})?$/, 'Cupo >= 0 con hasta 2 decimales.'),
});

type FormValues = z.infer<typeof schema>;

interface EditCorrectionCapModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  username: string;
  currentCap: string;
}

export function EditCorrectionCapModal({
  open,
  onOpenChange,
  userId,
  username,
  currentCap,
}: EditCorrectionCapModalProps) {
  const setCap = useSetCorrectionCap();
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { cap: currentCap },
  });

  useEffect(() => {
    if (open) reset({ cap: currentCap });
  }, [open, currentCap, reset]);

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const onSubmit = handleSubmit(async (values) => {
    try {
      await setCap.mutateAsync({ userId, cap: values.cap });
      toast.success('Cupo actualizado', {
        description: `${username}: ${fmt(values.cap)} fichas / mes.`,
      });
      handleOpenChange(false);
    } catch (err) {
      toast.error('No se pudo actualizar el cupo', {
        description: mapError(err),
      });
    }
  });

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title="Cupo mensual de correcciones"
      description={`Cupo de ${username} para cargas por corrección / bonificación / reintegro.`}
      size="md"
      footer={
        <>
          <Button
            variant="secondary"
            size="md"
            type="button"
            onClick={() => handleOpenChange(false)}
            disabled={setCap.isPending}
          >
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="md"
            type="submit"
            form="edit-cap-form"
            disabled={setCap.isPending}
          >
            {setCap.isPending ? (
              <>
                <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                Guardando…
              </>
            ) : (
              <>
                <Wallet className="size-3.5" />
                Guardar cupo
              </>
            )}
          </Button>
        </>
      }
    >
      <form
        id="edit-cap-form"
        onSubmit={onSubmit}
        className="flex flex-col gap-5"
        noValidate
      >
        <div className="flex items-start gap-3 px-3 py-2.5 border border-[var(--color-border)] bg-[var(--color-bg)] border-l-2 border-l-[var(--color-accent)]">
          <Info className="size-4 text-[var(--color-accent-text)] mt-0.5 shrink-0" />
          <span className="text-[12px] text-[var(--color-fg)] leading-snug">
            El cupo es un <strong>techo mensual</strong>: el empleado puede
            mover hasta esa cantidad de fichas por mes en cargas por corrección.
            Se resetea el 1° de cada mes. <strong>0</strong> = no puede aplicar
            correcciones (aunque tenga el permiso).
          </span>
        </div>

        <FormField
          id="cap-amount"
          label="Cupo mensual"
          required
          error={errors.cap?.message}
          hint="En fichas. Ej: 50000 para $50k/mes."
        >
          <ChipsAmountInput
            id="cap-amount"
            placeholder="0.00"
            invalid={!!errors.cap}
            {...register('cap')}
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
  if (err.status === 403) return 'No tenés permiso para editar cupos.';
  if (err.status === 404) return 'Usuario no encontrado.';
  if (err.status === 400) {
    if (err.code === 'TARGET_NOT_EMPLOYEE') {
      return 'Solo se puede asignar cupo a usuarios con rol empleado. Ponelo en 0 para limpiar.';
    }
    return err.message || 'Datos inválidos.';
  }
  return err.message || 'Error inesperado.';
}
