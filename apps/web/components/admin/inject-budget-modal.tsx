/**
 * InjectBudgetModal — fondeo de PRESUPUESTO a la Casa (docs/16 §12).
 *
 * La tesorería es un TOPE MENSUAL de creación de fichas: el admin fija el monto
 * y el motivo directo. Modelo "banco central". Si el monto supera el disponible
 * del mes, hay que marcar el checkbox "Fondeo" para forzar el minteo (bypasea el
 * tope, queda auditado). Sin marcarlo, el backend responde 409
 * MINT_BUDGET_EXCEEDED.
 *
 * Requiere permiso `house.inject_capital`.
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, Info, Wallet } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { ChipsAmountInput } from '@/components/ui/chips-amount-input';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { isApiError } from '@/lib/api-client';
import {
  newHouseIdempotencyKey,
  useInjectBudget,
  useMintBudget,
} from '@/lib/hooks/use-house';

/** Umbral del default "sin límite" del tope mensual. */
const NO_LIMIT_THRESHOLD = 1e11;

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
    .min(3, 'Mínimo 3 caracteres.')
    .max(500, 'Máximo 500 caracteres.'),
  notes: z.string().max(1000).optional().or(z.literal('')),
});

type FormValues = z.infer<typeof schema>;

interface InjectBudgetModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InjectBudgetModal({ open, onOpenChange }: InjectBudgetModalProps) {
  const inject = useInjectBudget();
  const budget = useMintBudget();
  const [fondeo, setFondeo] = useState(false);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { amount: '', reason: '', notes: '' },
  });

  /**
   * D5: idempotency key para el submit — generada una sola vez por apertura del
   * modal. Si el request se retryea (timeout, doble click), el resubmit usa la
   * MISMA key y el backend devuelve la injection previa sin doble mint. Se
   * regenera al abrir el modal de nuevo (submits distintos = keys distintas).
   */
  const idempotencyKeyRef = useRef<string>(newHouseIdempotencyKey());
  useEffect(() => {
    if (open) {
      idempotencyKeyRef.current = newHouseIdempotencyKey();
      setFondeo(false);
    }
  }, [open]);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      reset();
      setFondeo(false);
    }
    onOpenChange(next);
  };

  // Estado del tope mensual y chequeo de si el monto ingresado lo supera.
  const status = budget.data;
  const noLimit =
    status !== undefined && Number(status.monthlyBudget) >= NO_LIMIT_THRESHOLD;
  const availableNum = status ? Number(status.available) : null;
  const amountRaw = watch('amount');
  const amountNum = Number(amountRaw);
  const exceedsAvailable =
    availableNum !== null &&
    !noLimit &&
    Number.isFinite(amountNum) &&
    amountNum > 0 &&
    amountNum > availableNum;
  // Si supera el disponible y todavía no marcó Fondeo, bloqueamos el submit.
  const blockedByBudget = exceedsAvailable && !fondeo;

  const onSubmit = handleSubmit(async (values) => {
    try {
      const res = await inject.mutateAsync({
        amount: values.amount,
        reason: values.reason,
        notes: values.notes || undefined,
        idempotencyKey: idempotencyKeyRef.current,
        fondeo,
      });
      toast.success('Presupuesto fondeado a la Casa', {
        description: `+${fmt(res.amount)} fichas. Motivo: ${res.reason}.`,
      });
      reset();
      setFondeo(false);
      handleOpenChange(false);
    } catch (err) {
      toast.error('No se pudo fondear el presupuesto', {
        description: mapError(err),
      });
    }
  });

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title="Fondear presupuesto a la Casa"
      description="Crea fichas en la Casa, capado por el tope mensual de minteo. Modelo banco central: solo vos emitís el presupuesto; todo lo demás drena de acá."
      size="lg"
      footer={
        <>
          <Button
            variant="secondary"
            size="md"
            type="button"
            onClick={() => handleOpenChange(false)}
            disabled={inject.isPending}
          >
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="md"
            type="submit"
            form="inject-budget-form"
            disabled={inject.isPending || blockedByBudget}
          >
            {inject.isPending ? (
              <>
                <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                Fondeando…
              </>
            ) : (
              <>
                <Wallet className="size-3.5" />
                Fondear presupuesto
              </>
            )}
          </Button>
        </>
      }
    >
      <form
        id="inject-budget-form"
        onSubmit={onSubmit}
        className="flex flex-col gap-5"
        noValidate
      >
        {/* Estado del tope mensual */}
        <div className="flex items-start gap-3 px-3 py-2.5 border border-[var(--color-border)] bg-[var(--color-bg-elevated)] border-l-2 border-l-[var(--color-accent)]">
          <Wallet className="size-4 text-[var(--color-accent-text)] mt-0.5 shrink-0" />
          <div className="flex flex-col gap-0.5 text-[12px] leading-snug">
            {budget.isLoading ? (
              <span className="text-[var(--color-fg-subtle)]">
                Cargando tope del mes…
              </span>
            ) : budget.isError || !status ? (
              <span className="text-[var(--color-fg-subtle)]">
                No se pudo cargar el tope mensual.
              </span>
            ) : noLimit ? (
              <span className="text-[var(--color-fg)]">
                <strong>Sin tope configurado.</strong> Podés mintear sin límite
                mensual. Usado este mes:{' '}
                <span className="font-mono">{fmt(status.mintedThisMonth)}</span>.
              </span>
            ) : (
              <span className="text-[var(--color-fg)]">
                Tope del mes:{' '}
                <strong className="font-mono">
                  {fmt(status.monthlyBudget)}
                </strong>{' '}
                · Usado:{' '}
                <span className="font-mono">{fmt(status.mintedThisMonth)}</span>{' '}
                · Disponible:{' '}
                <strong className="font-mono text-[var(--color-success)]">
                  {fmt(status.available)}
                </strong>
              </span>
            )}
          </div>
        </div>

        <div className="flex items-start gap-3 px-3 py-2.5 border border-[var(--color-border)] bg-[var(--color-bg)] border-l-2 border-l-[var(--color-accent)]">
          <Info className="size-4 text-[var(--color-accent-text)] mt-0.5 shrink-0" />
          <span className="text-[12px] text-[var(--color-fg)] leading-snug">
            Este fondeo es el <strong>techo de fichas</strong> que la plataforma
            puede repartir en el mes. Si superás el disponible, marcá{' '}
            <strong>Fondeo</strong> para forzarlo. Todo queda{' '}
            <strong>auditado</strong> con motivo obligatorio (severity high).
          </span>
        </div>

        <FormField
          id="ib-amount"
          label="Monto"
          required
          error={errors.amount?.message}
          hint="Hasta 2 decimales. Ej: 1000000 (un millón de fichas para el mes)."
        >
          <ChipsAmountInput
            id="ib-amount"
            placeholder="0.00"
            invalid={!!errors.amount}
            {...register('amount')}
          />
        </FormField>

        {/* Advertencia cuando el monto supera el disponible del mes */}
        {exceedsAvailable && (
          <div className="flex items-start gap-3 px-3 py-2.5 border border-[var(--color-warning)] bg-[var(--color-warning-bg)] border-l-2 border-l-[var(--color-warning)]">
            <AlertTriangle className="size-4 text-[var(--color-warning)] mt-0.5 shrink-0" />
            <span className="text-[12px] text-[var(--color-fg)] leading-snug">
              Este monto <strong>supera tu disponible del mes</strong> (
              <span className="font-mono">
                {status ? fmt(status.available) : '—'}
              </span>
              ). Marcá <strong>Fondeo</strong> para forzarlo.
            </span>
          </div>
        )}

        {/* Checkbox de fondeo (bypass del tope mensual) */}
        <label className="flex items-start gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={fondeo}
            onChange={(e) => setFondeo(e.target.checked)}
            className="mt-0.5 size-4 accent-[var(--color-accent)] cursor-pointer"
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-[13px] text-[var(--color-fg)] font-medium">
              Fondeo (excede el tope mensual a propósito)
            </span>
            <span className="text-[11px] text-[var(--color-fg-subtle)] leading-snug">
              Bypasea el tope del mes. El minteo se hace igual y queda auditado.
            </span>
          </span>
        </label>

        <FormField
          id="ib-reason"
          label="Motivo"
          required
          error={errors.reason?.message}
          hint="Texto libre. Queda en el audit log permanente."
        >
          <Input
            id="ib-reason"
            type="text"
            invalid={!!errors.reason}
            placeholder="Presupuesto julio 2026"
            {...register('reason')}
          />
        </FormField>

        <FormField
          id="ib-notes"
          label="Notas"
          error={errors.notes?.message}
          hint="Opcional. Detalle interno adicional."
        >
          <Input
            id="ib-notes"
            type="text"
            invalid={!!errors.notes}
            placeholder="Recarga inicial del mes, cierre trimestral, etc."
            {...register('notes')}
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
  if (err.status === 409 && err.code === 'MINT_BUDGET_EXCEEDED') {
    return 'Superás el tope mensual. Marcá Fondeo para forzar el minteo.';
  }
  if (err.status === 403) return 'No tenés permiso para fondear la Casa.';
  if (err.status === 404) {
    return err.code === 'HOUSE_NOT_PROVISIONED'
      ? 'La Casa no está provisionada en este tenant.'
      : err.message || 'No encontrado.';
  }
  if (err.status === 400) return err.message || 'Datos inválidos.';
  return err.message || 'Error inesperado.';
}
