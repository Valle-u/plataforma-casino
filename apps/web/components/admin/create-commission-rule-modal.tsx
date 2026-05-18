/**
 * CreateCommissionRuleModal — crea una nueva regla de comisión.
 *
 * Campos:
 *   - role: dropdown con los 5 roles operativos (admin_tenant excluido —
 *     no tiene sentido pagarle commission al admin de su propio tenant).
 *   - eventType: dropdown con KNOWN_EVENT_TYPES.
 *   - pct: number 0.00 - 100.00 (string en API por precisión).
 *   - active (default true).
 *   - notes (opcional).
 *
 * Unique constraint (role, event_type) — backend devuelve 409 si duplica.
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { isApiError } from '@/lib/api-client';
import {
  useCreateCommissionRule,
  type CommissionEventType,
} from '@/lib/hooks/use-commissions';
import { cn } from '@/lib/cn';

const ROLES: { value: string; label: string }[] = [
  { value: 'socio', label: 'Socio' },
  { value: 'distribuidor', label: 'Distribuidor' },
  { value: 'cajero', label: 'Cajero' },
  { value: 'empleado', label: 'Empleado' },
];

const EVENT_TYPES: { value: CommissionEventType; label: string; hint: string }[] = [
  {
    value: 'deposit_approved',
    label: 'Depósito aprobado',
    hint: 'Se calcula cuando un cajero aprueba un depósito del cliente.',
  },
  {
    value: 'withdrawal_paid',
    label: 'Retiro pagado',
    hint: 'Se calcula cuando se marca un retiro como pagado.',
  },
];

const pctRegex = /^(?:100(?:\.00?)?|\d{1,2}(?:\.\d{1,2})?)$/;

const schema = z.object({
  role: z.string().min(2),
  eventType: z.enum(['deposit_approved', 'withdrawal_paid']),
  pct: z
    .string()
    .min(1, 'Requerido.')
    .regex(pctRegex, '0.00 - 100.00 con hasta 2 decimales.'),
  active: z.boolean(),
  notes: z.string().max(500).optional().or(z.literal('')),
});

type FormValues = z.infer<typeof schema>;

interface CreateCommissionRuleModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateCommissionRuleModal({
  open,
  onOpenChange,
}: CreateCommissionRuleModalProps) {
  const create = useCreateCommissionRule();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      role: 'cajero',
      eventType: 'deposit_approved',
      pct: '5.00',
      active: true,
      notes: '',
    },
  });

  useEffect(() => {
    if (!open) {
      reset();
      setServerError(null);
    }
  }, [open, reset]);

  const selectedEvent = watch('eventType');
  const eventHint = EVENT_TYPES.find((e) => e.value === selectedEvent)?.hint;

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const created = await create.mutateAsync({
        role: values.role,
        eventType: values.eventType,
        pct: values.pct,
        active: values.active,
        notes: values.notes && values.notes.trim() !== '' ? values.notes : null,
      });
      toast.success('Regla creada', {
        description: `${created.role} → ${created.eventType} = ${created.pct}%`,
      });
      onOpenChange(false);
    } catch (err) {
      const msg = mapError(err);
      setServerError(msg);
      toast.error('No se pudo crear', { description: msg });
    }
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Nueva regla de comisión"
      description="Cuando ocurre el evento, el rol de cada ancestor del cliente cobra el % configurado."
      size="md"
      footer={
        <>
          <Button
            variant="secondary"
            size="md"
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={create.isPending}
          >
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="md"
            type="submit"
            form="create-commission-rule-form"
            disabled={create.isPending}
          >
            {create.isPending ? (
              <>
                <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                Creando…
              </>
            ) : (
              <>
                <Plus className="size-3.5" />
                Crear
              </>
            )}
          </Button>
        </>
      }
    >
      <form
        id="create-commission-rule-form"
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
        noValidate
      >
        {serverError && (
          <div className="px-3 py-2 border border-[var(--color-accent-border)] bg-[var(--color-accent-subtle)] border-l-2 border-l-[var(--color-accent)] text-[12px] text-[var(--color-fg)]">
            {serverError}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            id="cr-role"
            label="Rol beneficiario"
            required
            error={errors.role?.message}
            hint="El rol que ganará la commission."
          >
            <Select id="cr-role" invalid={!!errors.role} {...register('role')}>
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField
            id="cr-pct"
            label="Porcentaje"
            required
            error={errors.pct?.message}
            hint="0.00 - 100.00. Hasta 2 decimales."
          >
            <Input
              id="cr-pct"
              type="text"
              inputMode="decimal"
              placeholder="5.00"
              className="font-mono"
              invalid={!!errors.pct}
              {...register('pct')}
            />
          </FormField>
        </div>

        <FormField
          id="cr-event"
          label="Evento"
          required
          error={errors.eventType?.message}
          hint={eventHint}
        >
          <Select
            id="cr-event"
            invalid={!!errors.eventType}
            {...register('eventType')}
          >
            {EVENT_TYPES.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField
          id="cr-notes"
          label="Notas"
          error={errors.notes?.message}
          hint="Opcional. Contexto para el equipo."
        >
          <textarea
            id="cr-notes"
            rows={3}
            placeholder="Ej: bajada del 7% al 5% en Q2 por margen."
            className={cn(
              'flex w-full px-3 py-2 resize-y',
              'bg-[var(--color-bg-subtle)] text-[var(--color-fg)]',
              'border border-[var(--color-border)]',
              'text-[12px] leading-relaxed',
              'transition-[border-color,box-shadow] duration-150',
              'hover:border-[var(--color-border-strong)]',
              'focus:outline-none focus:border-[var(--color-accent)]',
              'focus:shadow-[0_0_0_3px_var(--color-accent-glow)]',
            )}
            {...register('notes')}
          />
        </FormField>

        <label className="flex items-center gap-2 text-[12px] text-[var(--color-fg)] cursor-pointer select-none">
          <input
            type="checkbox"
            {...register('active')}
            className="size-4 accent-[var(--color-accent)] cursor-pointer"
          />
          Activar inmediatamente
        </label>
      </form>
    </Modal>
  );
}

function mapError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.status === 409) return 'Ya existe una regla para ese rol + evento.';
  if (err.status === 403) return 'No tenés permiso para configurar comisiones.';
  if (err.status === 400) return err.message || 'Datos inválidos.';
  return err.message || 'Error inesperado.';
}
