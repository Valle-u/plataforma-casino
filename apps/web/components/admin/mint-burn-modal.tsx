/**
 * MintBurnModal — flow compartido para mint y burn.
 *
 * Diferencias entre mint y burn:
 *   - Acción del CTA + variant del botón.
 *   - Mensaje de warning visible (mint suma valor, burn lo destruye).
 *   - Hook usado.
 *
 * Lo demás (form, validación, UI) es idéntico.
 *
 * Idempotency: el hook genera la key automáticamente. Si el usuario
 * doble-clickea el botón, react-hook-form bloquea el submit duplicado
 * via `isSubmitting` + el botón disabled.
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Coins, Flame, ShieldAlert } from 'lucide-react';
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
  useBurn,
  useMint,
  type MintBurnPayload,
} from '@/lib/hooks/use-wallet';

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
  referenceId: z.string().max(100).optional().or(z.literal('')),
  notes: z.string().max(1000).optional().or(z.literal('')),
});

type FormValues = z.infer<typeof schema>;

export type MintBurnMode = 'mint' | 'burn';

interface MintBurnModalProps {
  mode: MintBurnMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Balance actual — para mostrar lo que va a quedar después de burn. */
  currentBalance: string;
}

const COPY: Record<
  MintBurnMode,
  {
    title: string;
    description: string;
    cta: string;
    icon: typeof Coins;
    successMsg: string;
    warning: string;
  }
> = {
  mint: {
    title: 'Crear fichas',
    description:
      'Genera nuevas fichas en tu wallet. La operación queda registrada en el audit log.',
    cta: 'Crear fichas',
    icon: Coins,
    successMsg: 'Fichas creadas',
    warning:
      'Mint crea valor desde la nada. Solo debe usarse para fondear el sistema o ajustar errores.',
  },
  burn: {
    title: 'Destruir fichas',
    description:
      'Destruye fichas de tu wallet. La operación queda registrada en el audit log.',
    cta: 'Destruir fichas',
    icon: Flame,
    successMsg: 'Fichas destruidas',
    warning:
      'Burn destruye valor permanentemente. Verificá el monto y motivo antes de confirmar.',
  },
};

export function MintBurnModal({
  mode,
  open,
  onOpenChange,
  currentBalance,
}: MintBurnModalProps) {
  const mint = useMint();
  const burn = useBurn();
  const mutation = mode === 'mint' ? mint : burn;
  const meta = COPY[mode];
  const Icon = meta.icon;

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { amount: '', reason: '', referenceId: '', notes: '' },
  });

  const amount = watch('amount');
  const computedAfter = computeBalanceAfter(currentBalance, amount, mode);

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const onSubmit = handleSubmit(async (values) => {
    const payload: MintBurnPayload = {
      amount: values.amount,
      reason: values.reason,
      referenceId: values.referenceId || undefined,
      notes: values.notes || undefined,
    };
    try {
      const result = await mutation.mutateAsync(payload);
      toast.success(meta.successMsg, {
        description: `Nuevo balance: ${result.wallet.balance} FICHAS`,
      });
      reset();
      handleOpenChange(false);
    } catch (err) {
      toast.error(`No se pudo ${mode === 'mint' ? 'crear' : 'destruir'} fichas`, {
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
            variant={mode === 'burn' ? 'danger' : 'primary'}
            size="md"
            type="submit"
            form="mint-burn-form"
            disabled={mutation.isPending}
          >
            {mutation.isPending ? (
              <>
                <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                Procesando…
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
        id="mint-burn-form"
        onSubmit={onSubmit}
        className="flex flex-col gap-5"
        noValidate
      >
        {/* Warning banner */}
        <div className="flex items-start gap-3 px-3 py-2.5 border border-[var(--color-accent-border)] bg-[var(--color-accent-subtle)] border-l-2 border-l-[var(--color-accent)]">
          <ShieldAlert className="size-4 text-[var(--color-accent-text)] mt-0.5 shrink-0" />
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-accent-text)] font-medium">
              Operación crítica
            </span>
            <span className="text-[12px] text-[var(--color-fg)]">
              {meta.warning}
            </span>
          </div>
        </div>

        {/* Amount field — el más importante visualmente */}
        <FormField
          id="mb-amount"
          label="Monto"
          required
          error={errors.amount?.message}
          hint={
            amount && !errors.amount
              ? `Balance final: ${computedAfter} FICHAS`
              : 'Hasta 2 decimales. Ej: 1500.50'
          }
        >
          <ChipsAmountInput
            id="mb-amount"
            placeholder="0.00"
            invalid={!!errors.amount}
            {...register('amount')}
          />
        </FormField>

        <FormField
          id="mb-reason"
          label="Motivo"
          required
          error={errors.reason?.message}
          hint="Texto libre. Queda en el audit log permanente."
        >
          <Input
            id="mb-reason"
            type="text"
            invalid={!!errors.reason}
            placeholder={
              mode === 'mint'
                ? 'Fondeo inicial del tenant'
                : 'Ajuste por reconciliación bancaria'
            }
            {...register('reason')}
          />
        </FormField>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField
            id="mb-referenceId"
            label="Referencia"
            error={errors.referenceId?.message}
            hint="Opcional. ID externo (banco, wire, etc.)."
          >
            <Input
              id="mb-referenceId"
              type="text"
              invalid={!!errors.referenceId}
              {...register('referenceId')}
            />
          </FormField>

          <FormField
            id="mb-notes"
            label="Notas"
            error={errors.notes?.message}
            hint="Opcional. Detalle interno."
          >
            <Input
              id="mb-notes"
              type="text"
              invalid={!!errors.notes}
              {...register('notes')}
            />
          </FormField>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Calcula el balance proyectado tras la operación. Usa BigInt-style en
 * cents para evitar floats.
 */
function computeBalanceAfter(
  current: string,
  amount: string,
  mode: MintBurnMode,
): string {
  if (!amount || !/^\d+(\.\d{1,2})?$/.test(amount)) return current;
  try {
    const curCents = toCents(current);
    const amtCents = toCents(amount);
    const afterCents = mode === 'mint' ? curCents + amtCents : curCents - amtCents;
    return fromCents(afterCents);
  } catch {
    return current;
  }
}

function toCents(amount: string): number {
  const [int, dec = ''] = amount.split('.');
  const decPadded = (dec + '00').slice(0, 2);
  return Number(int) * 100 + Number(decPadded);
}

function fromCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const int = Math.floor(abs / 100);
  const dec = (abs % 100).toString().padStart(2, '0');
  return `${sign}${int}.${dec}`;
}

function mapServerError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.status === 409) {
    if (err.code === 'INSUFFICIENT_BALANCE') {
      return 'No tenés saldo suficiente para esta operación.';
    }
    if (err.code === 'IDEMPOTENCY_CONFLICT') {
      return 'Ya existe una operación con esa key. Reintentá.';
    }
    return err.message || 'Conflicto al procesar.';
  }
  if (err.status === 403) return 'No tenés permiso para esta operación.';
  if (err.status === 400) {
    if (err.code === 'TWO_FA_REQUIRED') {
      return 'Esta operación requiere código 2FA. Configurá tu cuenta.';
    }
    return err.message || 'Datos inválidos.';
  }
  return err.message || 'Error inesperado.';
}
