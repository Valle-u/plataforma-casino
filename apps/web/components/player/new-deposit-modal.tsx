/**
 * NewDepositModal — el jugador solicita un depósito.
 *
 * Flow:
 *   1. Selecciona método de pago (de la lista activa del tenant).
 *   2. Aparecen los datos del método (CBU / address USDT / etc.) para que
 *      el jugador transfiera por fuera del sistema.
 *   3. Tipea monto fiat + monto chips deseado + comprobante URL (opcional).
 *   4. Submit → backend crea deposit pending. El cajero después aprueba o rechaza.
 *
 * El flow asume que el jugador YA hizo la transferencia. El método sólo
 * sirve para que el cajero vea contra qué se concilia.
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowDownToLine, Copy, ShieldAlert } from 'lucide-react';
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
import { isApiError } from '@/lib/api-client';
import {
  useCreateDeposit,
  type CreateDepositPayload,
} from '@/lib/hooks/use-deposits';
import {
  usePaymentMethods,
  type PaymentMethod,
} from '@/lib/hooks/use-payment-methods';

const AMOUNT_REGEX = /^(?!0+(?:\.0+)?$)\d+(?:\.\d{1,2})?$/;

const schema = z.object({
  methodId: z.string().uuid('Seleccioná un método de pago.'),
  amountFiat: z
    .string()
    .min(1, 'Requerido.')
    .regex(AMOUNT_REGEX, 'Monto > 0 con hasta 2 decimales.'),
  currencyFiat: z.enum(['ARS', 'USDT', 'USD', 'BRL']),
  amountChips: z
    .string()
    .min(1, 'Requerido.')
    .regex(AMOUNT_REGEX, 'Monto > 0 con hasta 2 decimales.'),
  receiptUrl: z
    .string()
    .max(500)
    .optional()
    .or(z.literal('')),
});

type FormValues = z.infer<typeof schema>;

interface NewDepositModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewDepositModal({ open, onOpenChange }: NewDepositModalProps) {
  const methods = usePaymentMethods(true);
  const create = useCreateDeposit();

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      methodId: '',
      amountFiat: '',
      currencyFiat: 'ARS',
      amountChips: '',
      receiptUrl: '',
    },
  });

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const selectedMethodId = watch('methodId');
  const selectedMethod = methods.data?.data.find((m) => m.id === selectedMethodId);

  const onSubmit = handleSubmit(async (values) => {
    const payload: CreateDepositPayload = {
      methodId: values.methodId,
      amountFiat: values.amountFiat,
      currencyFiat: values.currencyFiat,
      amountChips: values.amountChips,
      receiptUrl: values.receiptUrl || undefined,
    };
    try {
      const res = await create.mutateAsync(payload);
      toast.success('Depósito solicitado', {
        description: `#${res.deposit.id.slice(0, 8)} · queda en revisión.`,
      });
      onOpenChange(false);
    } catch (err) {
      toast.error('No se pudo crear el depósito', {
        description: mapError(err),
      });
    }
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Solicitar depósito"
      description="Transferí primero por fuera y después cargá los datos acá. El cajero confirma manualmente."
      size="lg"
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
            form="new-deposit-form"
            disabled={create.isPending || methods.isLoading}
          >
            {create.isPending ? (
              <>
                <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                Solicitando…
              </>
            ) : (
              <>
                <ArrowDownToLine className="size-3.5" />
                Solicitar
              </>
            )}
          </Button>
        </>
      }
    >
      <form
        id="new-deposit-form"
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
        noValidate
      >
        {methods.data && methods.data.data.length === 0 && (
          <div className="flex items-start gap-3 px-3 py-2.5 border border-[var(--color-accent-border)] bg-[var(--color-accent-subtle)] border-l-2 border-l-[var(--color-accent)]">
            <ShieldAlert className="size-4 text-[var(--color-accent)] mt-0.5 shrink-0" />
            <span className="text-[12px] text-[var(--color-fg)]">
              Este tenant no tiene métodos de pago configurados todavía.
              Contactá al operador.
            </span>
          </div>
        )}

        <FormField
          id="dep-method"
          label="Método de pago"
          required
          error={errors.methodId?.message}
          hint={
            methods.isLoading
              ? 'Cargando métodos…'
              : 'Elegí el medio por el que vas a transferir.'
          }
        >
          <Select
            id="dep-method"
            invalid={!!errors.methodId}
            disabled={methods.isLoading}
            {...register('methodId')}
          >
            <option value="">— Seleccioná —</option>
            {methods.data?.data.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} · {labelType(m.type)}
              </option>
            ))}
          </Select>
        </FormField>

        {/* Detalles del método seleccionado */}
        {selectedMethod && <MethodDetails method={selectedMethod} />}

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-4">
          <FormField
            id="dep-amount-fiat"
            label="Monto transferido"
            required
            error={errors.amountFiat?.message}
            hint="Lo que enviaste por el método elegido."
          >
            <Input
              id="dep-amount-fiat"
              type="text"
              inputMode="decimal"
              invalid={!!errors.amountFiat}
              placeholder="0.00"
              className="font-mono"
              {...register('amountFiat')}
            />
          </FormField>

          <FormField
            id="dep-currency"
            label="Moneda"
            required
            error={errors.currencyFiat?.message}
          >
            <Select
              id="dep-currency"
              invalid={!!errors.currencyFiat}
              {...register('currencyFiat')}
            >
              <option value="ARS">ARS</option>
              <option value="USDT">USDT</option>
              <option value="USD">USD</option>
              <option value="BRL">BRL</option>
            </Select>
          </FormField>
        </div>

        <FormField
          id="dep-chips"
          label="Chips a acreditar"
          required
          error={errors.amountChips?.message}
          hint="El cajero valida el ratio según el método. Si difiere, te avisa."
        >
          <ChipsAmountInput
            id="dep-chips"
            placeholder="0.00"
            invalid={!!errors.amountChips}
            {...register('amountChips')}
          />
        </FormField>

        <FormField
          id="dep-receipt"
          label="URL del comprobante"
          error={errors.receiptUrl?.message}
          hint="Opcional. Imagen pública o link al PDF del comprobante."
        >
          <Input
            id="dep-receipt"
            type="url"
            invalid={!!errors.receiptUrl}
            placeholder="https://..."
            {...register('receiptUrl')}
          />
        </FormField>
      </form>
    </Modal>
  );
}

function MethodDetails({ method }: { method: PaymentMethod }) {
  const entries = Object.entries(method.config ?? {});
  if (entries.length === 0) {
    return (
      <div className="px-3 py-2.5 border border-[var(--color-border)] bg-[var(--color-bg-subtle)] text-[11px] text-[var(--color-fg-subtle)] italic">
        Sin datos adicionales — consultá al operador.
      </div>
    );
  }
  return (
    <div className="border border-[var(--color-border-strong)] bg-[var(--color-bg)] p-3 flex flex-col gap-2">
      <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-medium">
        Datos para transferir
      </span>
      <ul className="flex flex-col gap-1.5">
        {entries.map(([key, value]) => (
          <li key={key} className="flex items-center justify-between gap-3">
            <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)] font-mono">
              {key}
            </span>
            <CopyField value={String(value)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* ignore */
        }
      }}
      className="group flex items-center gap-2 px-2 py-1 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] hover:border-[var(--color-accent)] transition-colors text-[12px] font-mono text-[var(--color-fg)] max-w-[60%] truncate"
      title="Copiar"
    >
      <span className="truncate">{value}</span>
      <Copy
        className={
          copied
            ? 'size-3 text-[var(--color-success)] shrink-0'
            : 'size-3 text-[var(--color-fg-subtle)] shrink-0'
        }
      />
    </button>
  );
}

function labelType(type: string): string {
  switch (type) {
    case 'bank_transfer':
      return 'transferencia bancaria';
    case 'crypto':
      return 'cripto';
    default:
      return type;
  }
}

function mapError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.status === 400) return err.message || 'Datos inválidos.';
  if (err.status === 409) {
    if (err.code === 'TOO_MANY_PENDING_DEPOSITS') {
      return 'Tenés demasiadas solicitudes pendientes. Esperá la resolución.';
    }
    return err.message || 'Conflicto al procesar.';
  }
  if (err.status === 429) return 'Demasiadas solicitudes seguidas. Esperá un minuto.';
  return err.message || 'Error inesperado.';
}
