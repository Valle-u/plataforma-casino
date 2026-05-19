/**
 * GrantBonusModal â€” flow de grant manual de bono.
 *
 * Espeja `GrantBonusDto` del backend:
 *   - userId: target del bono.
 *   - definitionId: bonus_definitions activa.
 *   - amount: positivo, hasta 2 decimales.
 *   - reason: min 10 chars, debe contener letras (anti-abuso del cajero).
 *   - notes: opcional.
 *
 * Idempotency-key auto-generada en el hook.
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Gift, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { ChipsAmountInput } from '@/components/ui/chips-amount-input';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { UserSelect } from '@/components/ui/user-select';
import { isApiError } from '@/lib/api-client';
import {
  useActiveBonusDefinitions,
  useGrantBonus,
  type GrantBonusPayload,
} from '@/lib/hooks/use-bonuses';
import { type TenantUserRow } from '@/lib/hooks/use-users';

const schema = z.object({
  definitionId: z.string().uuid('SeleccionÃ¡ un bono.'),
  amount: z
    .string()
    .min(1, 'Requerido.')
    .regex(
      /^(?!0+(?:\.0+)?$)\d+(?:\.\d{1,2})?$/,
      'Monto > 0 con hasta 2 decimales.',
    ),
  reason: z
    .string()
    .min(10, 'MÃ­nimo 10 caracteres descriptivos.')
    .max(500, 'MÃ¡ximo 500 caracteres.')
    .regex(/[a-zA-Z]{3,}/, 'Debe contener al menos 3 letras consecutivas.'),
  notes: z.string().max(1000).optional().or(z.literal('')),
});

type FormValues = z.infer<typeof schema>;

interface GrantBonusModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** ID del actor â€” para excluirlo del UserSelect. */
  actorUserId: string;
  /** Si estÃ¡, el selector de user aparece bloqueado (caso: grant desde
   * /users/:id/wallet o desde el detalle del user). */
  presetTargetUser?: TenantUserRow | null;
}

export function GrantBonusModal({
  open,
  onOpenChange,
  actorUserId,
  presetTargetUser,
}: GrantBonusModalProps) {
  const definitions = useActiveBonusDefinitions();
  const grant = useGrantBonus();

  const [target, setTarget] = useState<TenantUserRow | null>(
    presetTargetUser ?? null,
  );

  useEffect(() => {
    if (presetTargetUser !== undefined) setTarget(presetTargetUser ?? null);
  }, [presetTargetUser]);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { definitionId: '', amount: '', reason: '', notes: '' },
  });

  const selectedDefId = watch('definitionId');
  const selectedDef = definitions.data?.data.find((d) => d.id === selectedDefId);

  useEffect(() => {
    if (!open) {
      reset();
      if (!presetTargetUser) setTarget(null);
    }
  }, [open, reset, presetTargetUser]);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      reset();
      if (!presetTargetUser) setTarget(null);
    }
    onOpenChange(next);
  };

  const onSubmit = handleSubmit(async (values) => {
    if (!target) {
      toast.error('Falta seleccionar el destinatario');
      return;
    }
    const payload: GrantBonusPayload = {
      userId: target.id,
      definitionId: values.definitionId,
      amount: values.amount,
      reason: values.reason,
      notes: values.notes || undefined,
    };
    try {
      const result = await grant.mutateAsync(payload);
      toast.success('Bono otorgado', {
        description: `${result.grantedAmount} CHIPS Â· ${selectedDef?.name ?? 'bono'} â†’ ${target.displayName || target.username}`,
      });
      if (result.fraudWarning) {
        toast.warning('AtenciÃ³n: usuario en cluster confirmado de fraude', {
          description: 'El grant quedÃ³ registrado con audit severity:high.',
        });
      }
      handleOpenChange(false);
    } catch (err) {
      toast.error('No se pudo otorgar el bono', {
        description: mapServerError(err),
      });
    }
  });

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title="Otorgar bono"
      description="El bono se debita del funder configurado en la definition. Idempotency garantizada."
      size="lg"
      footer={
        <>
          <Button
            variant="secondary"
            size="md"
            type="button"
            onClick={() => handleOpenChange(false)}
            disabled={grant.isPending}
          >
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="md"
            type="submit"
            form="grant-bonus-form"
            disabled={grant.isPending}
          >
            {grant.isPending ? (
              <>
                <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                Otorgandoâ€¦
              </>
            ) : (
              <>
                <Gift className="size-3.5" />
                Otorgar
              </>
            )}
          </Button>
        </>
      }
    >
      <form
        id="grant-bonus-form"
        onSubmit={onSubmit}
        className="flex flex-col gap-5"
        noValidate
      >
        <div className="flex items-start gap-3 px-3 py-2.5 border border-[var(--color-border)] bg-[var(--color-bg)] border-l-2 border-l-[var(--color-accent)]">
          <ShieldAlert className="size-4 text-[var(--color-accent-text)] mt-0.5 shrink-0" />
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-accent-text)] font-medium">
              Audit severity:high
            </span>
            <span className="text-[12px] text-[var(--color-fg)]">
              Si el usuario estÃ¡ en un cluster confirmado de fraude, el sistema lo
              advierte pero NO bloquea â€” el cajero decide.
            </span>
          </div>
        </div>

        <FormField
          id="gb-target"
          label="Usuario destinatario"
          required
          hint={target ? `Bono para ${target.displayName || target.username}` : 'BuscÃ¡ por username, nombre o email'}
        >
          <UserSelect
            value={target}
            onSelect={setTarget}
            excludeUserId={actorUserId}
            disabled={!!presetTargetUser}
          />
        </FormField>

        <FormField
          id="gb-definition"
          label="Bono"
          required
          error={errors.definitionId?.message}
          hint={
            selectedDef
              ? `${selectedDef.type} Â· funder: ${selectedDef.fundedByUserId.slice(0, 8)}â€¦`
              : definitions.isLoading
                ? 'Cargando definitions...'
                : 'Solo bonos en status=active'
          }
        >
          <Select
            id="gb-definition"
            invalid={!!errors.definitionId}
            disabled={definitions.isLoading}
            {...register('definitionId')}
          >
            <option value="">â€” SeleccionÃ¡ â€”</option>
            {definitions.data?.data.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.code}) Â· {d.type}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField
          id="gb-amount"
          label="Monto"
          required
          error={errors.amount?.message}
          hint="Hasta 2 decimales. El backend valida contra el saldo del funder."
        >
          <ChipsAmountInput
            id="gb-amount"
            placeholder="0.00"
            invalid={!!errors.amount}
            {...register('amount')}
          />
        </FormField>

        <FormField
          id="gb-reason"
          label="Motivo"
          required
          error={errors.reason?.message}
          hint="MÃ­nimo 10 caracteres. Texto descriptivo (no 'test', 'abc')."
        >
          <Input
            id="gb-reason"
            type="text"
            invalid={!!errors.reason}
            placeholder="Ej: Welcome bonus por primer depÃ³sito de $100"
            {...register('reason')}
          />
        </FormField>

        <FormField
          id="gb-notes"
          label="Notas"
          error={errors.notes?.message}
          hint="Opcional. Detalle interno (no visible para el user)."
        >
          <Input
            id="gb-notes"
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
    if (err.code === 'BONUS_DEFINITION_NOT_ACTIVE') {
      return 'La definition seleccionada ya no estÃ¡ activa.';
    }
    if (err.code === 'FUNDER_INSUFFICIENT_BALANCE') {
      return 'El funder del bono no tiene saldo suficiente.';
    }
    if (err.code === 'GRANT_IDEMPOTENCY_CONFLICT') {
      return 'Ya existe un grant con esa key. ReintentÃ¡.';
    }
    return err.message || 'Conflicto al procesar.';
  }
  if (err.status === 403) {
    if (err.code === 'OUT_OF_SCOPE') {
      return 'El usuario no estÃ¡ dentro de tu red operativa.';
    }
    return 'No tenÃ©s permiso para esta operaciÃ³n.';
  }
  if (err.status === 400) return err.message || 'Datos invÃ¡lidos.';
  if (err.status === 429) return 'Demasiados grants en poco tiempo. EsperÃ¡ un minuto.';
  return err.message || 'Error inesperado.';
}
