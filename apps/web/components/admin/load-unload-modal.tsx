/**
 * LoadUnloadModal â€” transferir chips entre el actor y un target user.
 *
 * Modos:
 *   - **load**: actor â†’ target (cajero fondeando jugador). El reason
 *     es opcional segÃºn el backend, pero lo pedimos para auditabilidad.
 *   - **unload**: target â†’ actor (cajero retirando de jugador). Reason
 *     OBLIGATORIO (regla del backend Â§4 â€” el cajero debe justificar
 *     por quÃ© retira saldo de un jugador).
 *
 * UX:
 *   - Si el modal recibe `presetTargetUser`, el selector aparece bloqueado
 *     mostrando ese user (caso: abrir desde /users/:id/wallet ya con el
 *     target conocido). Sino, selector libre.
 *   - Banner de info (no warning rojo) â€” load/unload son operaciones
 *     normales del flow del cajero, no destructivas como mint/burn.
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowDownToLine, ArrowUpToLine } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { ChipsAmountInput } from '@/components/ui/chips-amount-input';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { UserSelect } from '@/components/ui/user-select';
import { isApiError } from '@/lib/api-client';
import {
  useLoad,
  useUnload,
  type LoadUnloadPayload,
} from '@/lib/hooks/use-wallet';
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
    .min(3, 'MÃ­nimo 3 caracteres.')
    .max(500, 'MÃ¡ximo 500 caracteres.'),
  notes: z.string().max(500).optional().or(z.literal('')),
});

type FormValues = z.infer<typeof schema>;

export type LoadUnloadMode = 'load' | 'unload';

interface LoadUnloadModalProps {
  mode: LoadUnloadMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Si estÃ¡, el selector aparece bloqueado con este user. */
  presetTargetUser?: TenantUserRow | null;
  /** ID del actor â€” para excluirlo del selector. */
  actorUserId: string;
}

const COPY: Record<
  LoadUnloadMode,
  {
    title: string;
    description: string;
    cta: string;
    icon: typeof ArrowDownToLine;
    info: string;
    successMsg: string;
    placeholder: string;
  }
> = {
  load: {
    title: 'Cargar fichas a usuario',
    description:
      'TransferÃ­ chips de tu wallet a la wallet del usuario seleccionado.',
    cta: 'Cargar',
    icon: ArrowDownToLine,
    info: 'OperaciÃ³n normal de cajero. Las chips salen de tu balance y se acreditan al usuario.',
    successMsg: 'Carga ejecutada',
    placeholder: 'Ej: Carga del depÃ³sito #123',
  },
  unload: {
    title: 'Retirar fichas de usuario',
    description:
      'TransferÃ­ chips desde la wallet del usuario hacia tu wallet.',
    cta: 'Retirar',
    icon: ArrowUpToLine,
    info: 'Solo usar con motivo claro â€” el reason queda en audit log y se le notifica al user.',
    successMsg: 'Retiro ejecutado',
    placeholder: 'Ej: Reverso de carga errÃ³nea #123',
  },
};

export function LoadUnloadModal({
  mode,
  open,
  onOpenChange,
  presetTargetUser,
  actorUserId,
}: LoadUnloadModalProps) {
  const load = useLoad();
  const unload = useUnload();
  const mutation = mode === 'load' ? load : unload;
  const meta = COPY[mode];
  const Icon = meta.icon;

  const [target, setTarget] = useState<TenantUserRow | null>(
    presetTargetUser ?? null,
  );

  // Sync con preset si cambia (caso: reabrir el modal con otro user).
  useEffect(() => {
    if (presetTargetUser !== undefined) {
      setTarget(presetTargetUser ?? null);
    }
  }, [presetTargetUser]);

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
    if (!open) {
      reset();
      // Si NO habÃ­a preset, tambiÃ©n limpiamos el target seleccionado.
      if (!presetTargetUser) setTarget(null);
    }
  }, [open, reset, presetTargetUser, setTarget]);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      reset();
      if (!presetTargetUser) setTarget(null);
    }
    onOpenChange(next);
  };

  const onSubmit = handleSubmit(async (values) => {
    if (!target) {
      toast.error('Falta seleccionar usuario destinatario');
      return;
    }
    const payload: LoadUnloadPayload = {
      targetUserId: target.id,
      amount: values.amount,
      reason: values.reason,
      notes: values.notes || undefined,
    };
    try {
      await mutation.mutateAsync(payload);
      toast.success(meta.successMsg, {
        description: `${values.amount} CHIPS Â· ${target.displayName || target.username}`,
      });
      handleOpenChange(false);
    } catch (err) {
      toast.error(`No se pudo ${mode === 'load' ? 'cargar' : 'retirar'}`, {
        description: mapServerError(err),
      });
    }
  });

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title={meta.title}
      description={meta.description}
      size="lg"
      footer={
        <>
          <Button
            variant="secondary"
            size="md"
            type="button"
            onClick={() => handleOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="md"
            type="submit"
            form="load-unload-form"
            disabled={mutation.isPending}
          >
            {mutation.isPending ? (
              <>
                <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                Procesandoâ€¦
              </>
            ) : (
              <>
                <Icon className="size-3.5" />
                {meta.cta}
              </>
            )}
          </Button>
        </>
      }
    >
      <form
        id="load-unload-form"
        onSubmit={onSubmit}
        className="flex flex-col gap-5"
        noValidate
      >
        {/* Info banner â€” neutro (no warning rojo, op normal del cajero). */}
        <div className="flex items-start gap-3 px-3 py-2.5 border border-[var(--color-border)] bg-[var(--color-bg)] border-l-2 border-l-[var(--color-accent)]">
          <Icon className="size-4 text-[var(--color-accent-text)] mt-0.5 shrink-0" />
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-accent-text)] font-medium">
              {mode === 'load' ? 'Carga Â· actor â†’ user' : 'Retiro Â· user â†’ actor'}
            </span>
            <span className="text-[12px] text-[var(--color-fg)]">{meta.info}</span>
          </div>
        </div>

        {/* Target user selector */}
        <FormField
          id="lu-target"
          label="Usuario destinatario"
          required
          hint={
            target
              ? `Wallet de ${target.displayName || target.username}`
              : 'BuscÃ¡ por username, nombre o email'
          }
        >
          <UserSelect
            value={target}
            onSelect={setTarget}
            excludeUserId={actorUserId}
            disabled={!!presetTargetUser}
          />
        </FormField>

        {/* Amount */}
        <FormField
          id="lu-amount"
          label="Monto"
          required
          error={errors.amount?.message}
          hint="Hasta 2 decimales. Ej: 1500.50"
        >
          <ChipsAmountInput
            id="lu-amount"
            placeholder="0.00"
            invalid={!!errors.amount}
            {...register('amount')}
          />
        </FormField>

        {/* Reason */}
        <FormField
          id="lu-reason"
          label="Motivo"
          required
          error={errors.reason?.message}
          hint="Texto libre. Queda en audit log permanente."
        >
          <Input
            id="lu-reason"
            type="text"
            invalid={!!errors.reason}
            placeholder={meta.placeholder}
            {...register('reason')}
          />
        </FormField>

        {/* Notes */}
        <FormField
          id="lu-notes"
          label="Notas"
          error={errors.notes?.message}
          hint="Opcional. Detalle interno."
        >
          <Input
            id="lu-notes"
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
  if (!isApiError(err)) return 'Error de conexiÃ³n.';
  if (err.status === 409) {
    if (err.code === 'INSUFFICIENT_BALANCE') {
      return 'Saldo insuficiente para esta operaciÃ³n.';
    }
    if (err.code === 'IDEMPOTENCY_CONFLICT') {
      return 'Ya existe una operaciÃ³n con esa key. ReintentÃ¡.';
    }
    if (err.code === 'SELF_TRANSFER') {
      return 'No podÃ©s transferir a tu propia wallet.';
    }
    if (err.code === 'TARGET_NOT_FOUND') {
      return 'El usuario destinatario no existe.';
    }
    return err.message || 'Conflicto al procesar.';
  }
  if (err.status === 403) {
    if (err.code === 'OUT_OF_SCOPE') {
      return 'El usuario destinatario no estÃ¡ dentro de tu red.';
    }
    return 'No tenÃ©s permiso para esta operaciÃ³n.';
  }
  if (err.status === 400) {
    return err.message || 'Datos invÃ¡lidos.';
  }
  return err.message || 'Error inesperado.';
}
