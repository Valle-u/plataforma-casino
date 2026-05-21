/**
 * ChangeMyPasswordModal — Sprint 51.5.
 *
 * El user logueado cambia su propia password. Requiere:
 *   - currentPassword (verificada server-side).
 *   - newPassword + confirmación.
 *   - twoFaCode (solo si el actor tiene 2FA habilitada).
 *
 * Diferencia con ResetPasswordModal: este es self-service. No hay
 * typing-confirmation porque no hay "target" — es el propio user.
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { KeyRound } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { apiPost, isApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Tu password actual es requerida.'),
    newPassword: z
      .string()
      .min(8, 'Mínimo 8 caracteres.')
      .max(72, 'Máximo 72 caracteres.'),
    confirm: z.string(),
    twoFaCode: z
      .string()
      .optional()
      .refine((v) => !v || /^\d{6}$/.test(v), {
        message: 'Código 2FA debe ser 6 dígitos.',
      }),
  })
  .refine((v) => v.newPassword === v.confirm, {
    message: 'Las passwords no coinciden.',
    path: ['confirm'],
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: 'La nueva password debe ser diferente a la actual.',
    path: ['newPassword'],
  });

type FormValues = z.infer<typeof schema>;

interface ChangeMyPasswordModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ChangeMyPasswordModal({
  open,
  onOpenChange,
}: ChangeMyPasswordModalProps) {
  const { user } = useAuth();
  const hasTwoFa = !!user?.twoFaEnabled;

  const {
    register,
    handleSubmit,
    formState: { errors, isValid, isSubmitting },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirm: '',
      twoFaCode: '',
    },
  });

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      await apiPost('/tenant/auth/me/password', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
        twoFaCode: values.twoFaCode || undefined,
      });
      toast.success('Password actualizada', {
        description: 'Tu próximo login usa la nueva password.',
      });
      onOpenChange(false);
    } catch (err) {
      toast.error('No se pudo cambiar', { description: mapError(err) });
    }
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Cambiar mi password"
      description="Tu password actual + la nueva. Si tenés 2FA, también el código."
      size="md"
      footer={
        <>
          <Button
            variant="secondary"
            size="md"
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="md"
            type="submit"
            form="change-my-pwd-form"
            disabled={!isValid || isSubmitting}
          >
            {isSubmitting ? (
              <>
                <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                Guardando…
              </>
            ) : (
              <>
                <KeyRound className="size-3.5" />
                Cambiar password
              </>
            )}
          </Button>
        </>
      }
    >
      <form
        id="change-my-pwd-form"
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
        noValidate
      >
        <FormField
          id="cmp-current"
          label="Password actual"
          required
          error={errors.currentPassword?.message}
        >
          <Input
            id="cmp-current"
            type="password"
            autoComplete="current-password"
            invalid={!!errors.currentPassword}
            {...register('currentPassword')}
          />
        </FormField>

        <FormField
          id="cmp-new"
          label="Nueva password"
          required
          error={errors.newPassword?.message}
          hint="8 a 72 caracteres. Distinta a la actual."
        >
          <Input
            id="cmp-new"
            type="password"
            autoComplete="new-password"
            invalid={!!errors.newPassword}
            {...register('newPassword')}
          />
        </FormField>

        <FormField
          id="cmp-confirm"
          label="Confirmar nueva password"
          required
          error={errors.confirm?.message}
        >
          <Input
            id="cmp-confirm"
            type="password"
            autoComplete="new-password"
            invalid={!!errors.confirm}
            {...register('confirm')}
          />
        </FormField>

        {hasTwoFa && (
          <FormField
            id="cmp-2fa"
            label="Código 2FA"
            required
            error={errors.twoFaCode?.message}
            hint="6 dígitos de tu app autenticadora."
          >
            <Input
              id="cmp-2fa"
              type="text"
              inputMode="numeric"
              maxLength={6}
              invalid={!!errors.twoFaCode}
              placeholder="123456"
              className="font-mono"
              {...register('twoFaCode')}
            />
          </FormField>
        )}
      </form>
    </Modal>
  );
}

function mapError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.status === 401) {
    if (err.code === 'INVALID_CURRENT_PASSWORD') {
      return 'Tu password actual es incorrecta.';
    }
    return 'Credenciales inválidas.';
  }
  if (err.status === 400) {
    if (err.code === 'TWO_FA_REQUIRED') return 'Falta el código 2FA.';
    if (err.code === 'TWO_FA_CODE_INVALID') return 'Código 2FA inválido.';
    return err.message || 'Datos inválidos.';
  }
  return err.message || 'Error inesperado.';
}
