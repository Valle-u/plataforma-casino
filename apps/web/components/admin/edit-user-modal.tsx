/**
 * EditUserModal — editar datos básicos de un usuario desde la lista.
 *
 * Campos: displayName, email, phone.
 * Usa useUpdateUser del hook existente.
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Pencil } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { isApiError } from '@/lib/api-client';
import { useUpdateUser } from '@/lib/hooks/use-users';

const schema = z.object({
  displayName: z
    .string()
    .min(1, 'Requerido.')
    .max(100, 'Máximo 100 caracteres.'),
  email: z.string().email('Email inválido.').optional().or(z.literal('')),
});

type FormValues = z.infer<typeof schema>;

interface EditUserModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  username: string;
  currentDisplayName: string;
  currentEmail?: string | null;
}

export function EditUserModal({
  open,
  onOpenChange,
  userId,
  username,
  currentDisplayName,
  currentEmail,
}: EditUserModalProps) {
  const updateUser = useUpdateUser(userId);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      displayName: currentDisplayName,
      email: currentEmail ?? '',
    },
  });

  useEffect(() => {
    if (open) {
      reset({
        displayName: currentDisplayName,
        email: currentEmail ?? '',
      });
    }
  }, [open, currentDisplayName, currentEmail, reset]);

  async function onSubmit(values: FormValues) {
    try {
      await updateUser.mutateAsync({
        displayName: values.displayName,
        email: values.email || null,
      });
      toast.success('Usuario actualizado', {
        description: `@${username} fue editado correctamente.`,
      });
      onOpenChange(false);
    } catch (err) {
      if (isApiError(err)) {
        toast.error(err.message);
      } else {
        toast.error('No se pudo actualizar el usuario.');
      }
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Editar usuario"
      description={`Editando datos de @${username}`}
      size="sm"
      footer={
        <>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit(onSubmit)}
            disabled={isSubmitting}
          >
            <Pencil className="size-3" />
            Guardar
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => e.preventDefault()}>
        <FormField id="edit-display-name" label="Nombre visible" error={errors.displayName?.message} required>
          <Input
            {...register('displayName')}
            placeholder="Nombre para mostrar"
            autoFocus
          />
        </FormField>

        <FormField id="edit-email" label="Email" error={errors.email?.message}>
          <Input
            {...register('email')}
            type="email"
            placeholder="email@ejemplo.com"
          />
        </FormField>
      </form>
    </Modal>
  );
}
