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
import { Info, Lightbulb, Plus } from 'lucide-react';
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

  // Ejemplo en vivo: cuánto ganaría el rol elegido sobre una operación de
  // muestra ($10.000) con el % actual del form. Se recalcula al tipear.
  const pctValue = watch('pct');
  const roleValue = watch('role');
  const SAMPLE = 10000;
  const pctNum = Number(pctValue);
  const earned =
    pctValue && Number.isFinite(pctNum) && pctNum >= 0
      ? Math.round(SAMPLE * pctNum) / 100
      : null;
  const roleLabel = ROLES.find((r) => r.value === roleValue)?.label ?? roleValue;
  const eventVerb =
    selectedEvent === 'withdrawal_paid' ? 'cobra un retiro de' : 'deposita';
  const fmt = (n: number) => n.toLocaleString('es-AR');

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
      description="Definí cuánto gana un rol cuando un jugador de su red deposita o retira."
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

        {/* Explicación en lenguaje claro para el operador. */}
        <div className="flex items-start gap-3 px-3 py-2.5 border border-[var(--color-border)] bg-[var(--color-bg)] border-l-2 border-l-[var(--color-accent)]">
          <Info className="size-4 text-[var(--color-accent-text)] mt-0.5 shrink-0" />
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-accent-text)] font-medium">
              Cómo funcionan
            </span>
            <span className="text-[12px] text-[var(--color-fg)] leading-snug">
              Cuando un jugador deposita (o se le paga un retiro), las personas
              que lo tienen a cargo en su red —su cajero, y más arriba el
              distribuidor y el socio— ganan un % de esa operación como comisión.
              Acá definís cuánto gana cada rol. Se acumulan solas en cada
              operación y se liquidan después desde "Pendientes de liquidar".
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            id="cr-role"
            label="¿Quién gana la comisión?"
            required
            error={errors.role?.message}
            hint="El rol que cobra. Suele ser el cajero/distribuidor/socio que tiene al jugador en su red."
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
            hint="Qué % del monto de la operación gana. Ej: 5 = 5%."
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

        {/* Ejemplo en vivo — se recalcula con el % tipeado. */}
        <div className="flex flex-col gap-1 px-3 py-2.5 border border-[var(--color-border)] bg-[var(--color-bg)] border-l-2 border-l-[var(--color-success)]">
          <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-fg-muted)] font-medium flex items-center gap-1.5">
            <Lightbulb className="size-3.5 text-[var(--color-success)]" />
            Ejemplo
          </span>
          {earned !== null ? (
            <span className="text-[12px] text-[var(--color-fg)] leading-snug">
              Si un jugador {eventVerb} <strong>${fmt(SAMPLE)}</strong>, un{' '}
              <strong>{roleLabel}</strong> de su red gana{' '}
              <strong className="text-[var(--color-success)]">
                ${fmt(earned)}
              </strong>{' '}
              ({pctValue}%).
            </span>
          ) : (
            <span className="text-[12px] text-[var(--color-fg-subtle)]">
              Ingresá un porcentaje válido para ver el ejemplo.
            </span>
          )}
          <span className="text-[11px] text-[var(--color-fg-subtle)]">
            El % se calcula sobre el monto TOTAL de la operación. Si hay reglas
            para varios roles, los porcentajes se SUMAN (no se descuentan entre
            sí): ej. cajero 5% + distribuidor 2% + socio 1% = 8% del total.
          </span>
        </div>

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
