/**
 * ResetPasswordModal — Sprint 51.4.
 *
 * Admin/socio resetea la password de un user inferior. Pide:
 *   - newPassword (≥8 chars, confirmación inline).
 *   - twoFaCode si el actor tiene 2FA habilitada (campo opcional, el
 *     backend rebota con TWO_FA_REQUIRED si falta).
 *   - reason opcional (motivo para el audit log).
 *
 * Severidad alta (audit:high) — UI usa color de advertencia y exige
 * confirmación textual del username del target ("typing-confirmation"
 * pattern) para evitar misclicks.
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { KeyRound, ShieldAlert } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { isApiError } from '@/lib/api-client';
import { useResetUserPassword } from '@/lib/hooks/use-users';

const schema = z
  .object({
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
    usernameConfirm: z.string(),
    reason: z.string().max(500).optional().or(z.literal('')),
  })
  .refine((v) => v.newPassword === v.confirm, {
    message: 'Las passwords no coinciden.',
    path: ['confirm'],
  });

type FormValues = z.infer<typeof schema>;

interface ResetPasswordModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** ID del user al que le vamos a resetear la password. */
  targetUserId: string | null;
  /** Username del target (para mostrar + confirmación typed). */
  targetUsername: string;
  targetDisplayName: string;
  /** Si el actor logueado tiene 2FA habilitada (mostramos el campo). */
  actorHasTwoFa: boolean;
}

export function ResetPasswordModal({
  open,
  onOpenChange,
  targetUserId,
  targetUsername,
  targetDisplayName,
  actorHasTwoFa,
}: ResetPasswordModalProps) {
  const reset = useResetUserPassword(targetUserId);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isValid },
    reset: resetForm,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: {
      newPassword: '',
      confirm: '',
      twoFaCode: '',
      usernameConfirm: '',
      reason: '',
    },
  });

  useEffect(() => {
    if (!open) resetForm();
  }, [open, resetForm]);

  const usernameConfirm = watch('usernameConfirm');
  const usernameMatches = usernameConfirm.trim() === targetUsername;
  const canSubmit = isValid && usernameMatches && !reset.isPending;

  const onSubmit = handleSubmit(async (values) => {
    if (!usernameMatches) return;
    try {
      await reset.mutateAsync({
        newPassword: values.newPassword,
        twoFaCode: values.twoFaCode || undefined,
        reason: values.reason || undefined,
      });
      toast.success('Password reseteada', {
        description: `Avisale a @${targetUsername} la nueva password por el canal habitual.`,
      });
      onOpenChange(false);
    } catch (err) {
      toast.error('No se pudo resetear', { description: mapError(err) });
    }
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Resetear password"
      description={`Vas a resetear la password de @${targetUsername} (${targetDisplayName}). El usuario será notificado.`}
      size="md"
      footer={
        <>
          <Button
            variant="secondary"
            size="md"
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={reset.isPending}
          >
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="md"
            type="submit"
            form="reset-pwd-form"
            disabled={!canSubmit}
            className="bg-[var(--color-warning)] hover:bg-[#b45309] border-[var(--color-warning)]"
          >
            {reset.isPending ? (
              <>
                <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                Reseteando…
              </>
            ) : (
              <>
                <KeyRound className="size-3.5" />
                Resetear password
              </>
            )}
          </Button>
        </>
      }
    >
      <form
        id="reset-pwd-form"
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
        noValidate
      >
        {/* Banner de advertencia */}
        <div className="flex items-start gap-3 px-3 py-2.5 bg-[var(--color-bg)] border-l-2 border-l-[var(--color-warning)] border border-[var(--color-border)]">
          <ShieldAlert className="size-4 text-[var(--color-warning)] shrink-0 mt-0.5" />
          <div className="flex flex-col gap-1">
            <span className="text-[12px] text-[var(--color-fg)] font-medium">
              Acción sensible — queda registrada en audit (severity:high).
            </span>
            <span className="text-[11px] text-[var(--color-fg-muted)]">
              El usuario verá en sus notifications que vos reseteaste su
              password. Sus sesiones activas NO se cierran automáticamente.
            </span>
          </div>
        </div>

        <FormField
          id="rp-new"
          label="Nueva password"
          required
          error={errors.newPassword?.message}
          hint="8 a 72 caracteres."
        >
          <Input
            id="rp-new"
            type="password"
            autoComplete="new-password"
            invalid={!!errors.newPassword}
            {...register('newPassword')}
          />
        </FormField>

        <FormField
          id="rp-confirm"
          label="Confirmar password"
          required
          error={errors.confirm?.message}
        >
          <Input
            id="rp-confirm"
            type="password"
            autoComplete="new-password"
            invalid={!!errors.confirm}
            {...register('confirm')}
          />
        </FormField>

        {actorHasTwoFa && (
          <FormField
            id="rp-2fa"
            label="Código 2FA"
            required
            error={errors.twoFaCode?.message}
            hint="6 dígitos de tu app autenticadora."
          >
            <Input
              id="rp-2fa"
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

        <FormField
          id="rp-reason"
          label="Motivo (opcional)"
          error={errors.reason?.message}
          hint="Queda en el audit log."
        >
          <Input
            id="rp-reason"
            type="text"
            invalid={!!errors.reason}
            placeholder="Ej: usuario olvidó su password"
            {...register('reason')}
          />
        </FormField>

        <FormField
          id="rp-confirm-username"
          label={`Escribí "${targetUsername}" para confirmar`}
          required
          hint="Doble check para evitar misclicks."
        >
          <Input
            id="rp-confirm-username"
            type="text"
            autoComplete="off"
            placeholder={targetUsername}
            className={
              usernameConfirm.length > 0 && !usernameMatches
                ? 'border-[var(--color-danger)]'
                : undefined
            }
            {...register('usernameConfirm')}
          />
        </FormField>
      </form>
    </Modal>
  );
}

function mapError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.status === 403) {
    if (err.code === 'OUT_OF_SCOPE') {
      return 'No tenés autoridad sobre este usuario (no está en tu red).';
    }
    return 'No tenés permiso para resetear esta password.';
  }
  if (err.status === 404) return 'Usuario no encontrado.';
  if (err.status === 400) {
    if (err.code === 'TWO_FA_REQUIRED') return 'Falta el código 2FA.';
    if (err.code === 'TWO_FA_CODE_INVALID') return 'Código 2FA inválido.';
    if (err.code === 'CANNOT_RESET_OWN_PASSWORD') {
      return 'No podés resetear tu propia password desde este flujo.';
    }
    return err.message || 'Datos inválidos.';
  }
  return err.message || 'Error inesperado.';
}
