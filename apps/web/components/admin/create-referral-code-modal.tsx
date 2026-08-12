/**
 * CreateReferralCodeModal — crear o renombrar una campaña de referido.
 *
 * Una campaña = etiqueta interna (ej. "Instagram") + código auto-generado
 * en el backend. Solo se edita la etiqueta; el código no cambia nunca.
 *
 * ⚠️ Input NO controlado (react-hook-form `register`) — regla del proyecto:
 * los inputs controlados dentro de modales Radix pierden el foco en Opera
 * (ver DEVLOG 2026-08-11 / memory modal-input-rule).
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Megaphone } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { isApiError } from '@/lib/api-client';
import {
  useCreateReferralCode,
  useUpdateReferralCode,
  type ReferralCodeListItem,
} from '@/lib/hooks/use-referrals';

const schema = z.object({
  label: z
    .string()
    .trim()
    .min(2, 'Mínimo 2 caracteres.')
    .max(40, 'Máximo 40 caracteres.'),
});

type FormValues = z.infer<typeof schema>;

interface CreateReferralCodeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Si viene, el modal está en modo "renombrar". */
  editing?: ReferralCodeListItem | null;
}

export function CreateReferralCodeModal({
  open,
  onOpenChange,
  editing,
}: CreateReferralCodeModalProps) {
  const create = useCreateReferralCode();
  const update = useUpdateReferralCode();
  const isEditing = !!editing;
  const pending = create.isPending || update.isPending;

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { label: '' },
  });

  // Al abrir: precargar la etiqueta si es edición; limpiar si es alta.
  useEffect(() => {
    if (open) {
      reset({ label: editing?.label ?? '' });
    }
  }, [open, editing, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (isEditing && editing?.id) {
        await update.mutateAsync({ id: editing.id, label: values.label });
        toast.success('Campaña renombrada', { description: values.label });
      } else {
        const created = await create.mutateAsync({ label: values.label });
        toast.success('Campaña creada', {
          description: `${created.label} · ${created.code}`,
        });
      }
      onOpenChange(false);
    } catch (err) {
      toast.error('No se pudo guardar', { description: mapError(err) });
    }
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={isEditing ? 'Renombrar campaña' : 'Crear campaña'}
      description={
        isEditing
          ? 'Cambiá la etiqueta interna. El código no cambia.'
          : 'El código se genera solo. La etiqueta es interna, para que la reconozcas.'
      }
      size="sm"
      footer={
        <>
          <Button
            variant="secondary"
            size="md"
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="md"
            type="submit"
            form="referral-code-form"
            disabled={pending}
          >
            {pending ? (
              <>
                <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                Guardando…
              </>
            ) : (
              <>
                <Megaphone className="size-3.5" />
                {isEditing ? 'Guardar' : 'Crear'}
              </>
            )}
          </Button>
        </>
      }
    >
      <form
        id="referral-code-form"
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
        noValidate
      >
        <FormField
          id="rc-label"
          label="Etiqueta"
          required
          error={errors.label?.message}
          hint="Ej: Instagram, Facebook Ads, WhatsApp status."
        >
          <Input
            id="rc-label"
            type="text"
            invalid={!!errors.label}
            placeholder="Instagram"
            autoFocus
            {...register('label')}
          />
        </FormField>
      </form>
    </Modal>
  );
}

function mapError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.status === 409)
    return err.message || 'Llegaste al máximo de campañas activas.';
  if (err.status === 403) return 'No tenés permiso.';
  if (err.status === 400) return err.message || 'Datos inválidos.';
  if (err.status === 404) return 'La campaña no existe.';
  return err.message || 'Error inesperado.';
}
