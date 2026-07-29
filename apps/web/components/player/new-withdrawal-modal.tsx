/**
 * NewWithdrawalModal — el jugador solicita un retiro.
 *
 * Diferencias con depósito:
 *   - El backend HACE HOLD INMEDIATO sobre el balance al crear la
 *     solicitud. Si no hay saldo suficiente, 409 INSUFFICIENT_BALANCE.
 *     UX: mostrar balance disponible arriba del form + hint.
 *   - Datos del destino los tipea el JUGADOR (no el operador). Shape libre:
 *     transferencia → { cbu, alias, beneficiario }, cripto → { address, network }.
 *   - El operador después aprueba + marca como pagado fuera del sistema.
 *
 * Para MVP, los campos del target son simples (CBU/Alias para bank_transfer,
 * address para crypto). Si emerge necesidad de más campos, editor JSON
 * libre opcional.
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowUpToLine, ShieldAlert } from 'lucide-react';
import { useEffect, useMemo } from 'react';
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
  usePlayerPaymentMethods,
  type PaymentMethodType,
} from '@/lib/hooks/use-payment-methods';
import { useMyWallet } from '@/lib/hooks/use-wallet';
import {
  useCreateWithdrawal,
  type CreateWithdrawalPayload,
} from '@/lib/hooks/use-withdrawals';
import { fiatFromChips } from '@/lib/ratio';

const AMOUNT_REGEX = /^(?!0+(?:\.0+)?$)\d+(?:\.\d{1,2})?$/;

const schema = z
  .object({
    methodId: z.string().uuid('Seleccioná un método de pago.'),
    amountChips: z
      .string()
      .min(1, 'Requerido.')
      .regex(AMOUNT_REGEX, 'Monto > 0 con hasta 2 decimales.'),
    // bank_transfer fields (opcionales — validamos según method type abajo).
    cbu: z.string().max(60).optional().or(z.literal('')),
    alias: z.string().max(60).optional().or(z.literal('')),
    beneficiario: z.string().max(120).optional().or(z.literal('')),
    // crypto fields.
    network: z.string().max(40).optional().or(z.literal('')),
    address: z.string().max(200).optional().or(z.literal('')),
  })
  .refine(
    (v) => v.cbu || v.alias || v.address,
    {
      path: ['cbu'],
      message: 'Completá al menos un dato de destino (CBU/alias o address).',
    },
  );

type FormValues = z.infer<typeof schema>;

interface NewWithdrawalModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewWithdrawalModal({ open, onOpenChange }: NewWithdrawalModalProps) {
  const methods = usePlayerPaymentMethods();
  const wallet = useMyWallet();
  const create = useCreateWithdrawal();

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
      amountChips: '',
      cbu: '',
      alias: '',
      beneficiario: '',
      network: 'TRC20',
      address: '',
    },
  });

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const selectedMethodId = watch('methodId');
  const amountChips = watch('amountChips');
  const selectedMethod = methods.data?.data.find(
    (m) => m.id === selectedMethodId,
  );
  const methodType: PaymentMethodType | undefined = selectedMethod?.type;
  // Parte B: la plata se calcula del ratio del método (preview; el server es el
  // autoritativo). fichas ÷ chips_per_unit.
  const computedFiat =
    selectedMethod && amountChips && AMOUNT_REGEX.test(amountChips)
      ? fiatFromChips(amountChips, selectedMethod.chipsPerUnit)
      : null;

  const balance = wallet.data?.balance;
  const balanceNum = balance ? Number(balance) : 0;
  const requestedNum = amountChips ? Number(amountChips) : 0;
  const insufficient = useMemo(
    () => requestedNum > 0 && requestedNum > balanceNum,
    [requestedNum, balanceNum],
  );

  const onSubmit = handleSubmit(async (values) => {
    // Arma `targetAccount` según el type del método.
    const targetAccount: Record<string, unknown> = {};
    if (methodType === 'bank_transfer') {
      if (values.cbu) targetAccount.cbu = values.cbu;
      if (values.alias) targetAccount.alias = values.alias;
      if (values.beneficiario) targetAccount.beneficiario = values.beneficiario;
    } else if (methodType === 'crypto') {
      if (values.network) targetAccount.network = values.network;
      if (values.address) targetAccount.address = values.address;
    } else {
      // 'other' → todos los campos del form que tengan algo.
      if (values.cbu) targetAccount.cbu = values.cbu;
      if (values.alias) targetAccount.alias = values.alias;
      if (values.beneficiario) targetAccount.beneficiario = values.beneficiario;
      if (values.network) targetAccount.network = values.network;
      if (values.address) targetAccount.address = values.address;
    }

    const payload: CreateWithdrawalPayload = {
      methodId: values.methodId,
      amountChips: values.amountChips,
      // El server recalcula del ratio; mandamos el preview por compatibilidad.
      amountFiat: selectedMethod
        ? fiatFromChips(values.amountChips, selectedMethod.chipsPerUnit)
        : values.amountChips,
      currencyFiat: 'ARS',
      targetAccount,
    };

    try {
      await create.mutateAsync(payload);
      toast.success('Retiro solicitado', {
        description: 'Se descontó del balance disponible. Estado: pendiente.',
      });
      onOpenChange(false);
    } catch (err) {
      toast.error('No se pudo solicitar', { description: mapError(err) });
    }
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Solicitar retiro"
      description="El monto en fichas queda en hold inmediatamente. El operador acredita por fuera y marca como pagado."
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
            form="new-withdrawal-form"
            disabled={create.isPending || methods.isLoading || insufficient}
          >
            {create.isPending ? (
              <>
                <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                Solicitando…
              </>
            ) : (
              <>
                <ArrowUpToLine className="size-3.5" />
                Solicitar
              </>
            )}
          </Button>
        </>
      }
    >
      <form
        id="new-withdrawal-form"
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
        noValidate
      >
        {/* Balance disponible */}
        <div className="flex items-center justify-between px-3 py-2.5 border border-[var(--color-border)] bg-[var(--color-bg)]">
          <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
            Tu balance disponible
          </span>
          <span className="font-mono tabular-nums text-[14px] text-[var(--color-fg)]">
            {wallet.isLoading
              ? '—'
              : balance
                ? Number(balance).toLocaleString('es-AR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })
                : '0,00'}{' '}
            <span className="text-[10px] text-[var(--color-fg-subtle)]">FICHAS</span>
          </span>
        </div>

        {insufficient && (
          <div className="flex items-start gap-3 px-3 py-2.5 border border-[var(--color-accent-border)] bg-[var(--color-accent-subtle)] border-l-2 border-l-[var(--color-accent)]">
            <ShieldAlert className="size-4 text-[var(--color-accent-text)] mt-0.5 shrink-0" />
            <span className="text-[12px] text-[var(--color-fg)]">
              No tenés suficiente saldo para esta solicitud.
            </span>
          </div>
        )}

        <FormField
          id="wd-method"
          label="Método de cobro"
          required
          error={errors.methodId?.message}
          hint={
            methods.isLoading
              ? 'Cargando métodos…'
              : 'Por dónde querés recibir el pago.'
          }
        >
          <Select
            id="wd-method"
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

        {/* Campos del destino según type */}
        {methodType === 'bank_transfer' && (
          <div className="flex flex-col gap-3 p-3 border border-[var(--color-border)] bg-[var(--color-bg-subtle)]">
            <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-medium">
              Datos de tu cuenta bancaria
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField id="wd-cbu" label="CBU / CVU" hint="22 dígitos">
                <Input
                  id="wd-cbu"
                  type="text"
                  inputMode="numeric"
                  placeholder="0000003100000000000000"
                  className="font-mono"
                  {...register('cbu')}
                />
              </FormField>
              <FormField id="wd-alias" label="Alias">
                <Input
                  id="wd-alias"
                  type="text"
                  placeholder="mi.alias.banco"
                  {...register('alias')}
                />
              </FormField>
            </div>
            <FormField id="wd-beneficiario" label="Titular">
              <Input
                id="wd-beneficiario"
                type="text"
                placeholder="Nombre y apellido del titular"
                {...register('beneficiario')}
              />
            </FormField>
          </div>
        )}

        {methodType === 'crypto' && (
          <div className="flex flex-col gap-3 p-3 border border-[var(--color-border)] bg-[var(--color-bg-subtle)]">
            <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-medium">
              Wallet de destino
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-3">
              <FormField id="wd-network" label="Red">
                <Input
                  id="wd-network"
                  type="text"
                  placeholder="TRC20"
                  className="font-mono"
                  {...register('network')}
                />
              </FormField>
              <FormField id="wd-address" label="Address">
                <Input
                  id="wd-address"
                  type="text"
                  placeholder="T..."
                  className="font-mono"
                  {...register('address')}
                />
              </FormField>
            </div>
          </div>
        )}

        {errors.cbu?.message && !errors.cbu.type && (
          <span className="text-[11px] text-[var(--color-accent-text)]">
            {errors.cbu.message}
          </span>
        )}

        <FormField
          id="wd-chips"
          label="Monto a retirar"
          required
          error={errors.amountChips?.message}
          hint="En fichas. Se descuenta del balance."
        >
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-[var(--color-fg-muted)] font-mono">$</span>
            <ChipsAmountInput
              id="wd-chips"
              placeholder="0.00"
              invalid={!!errors.amountChips || insufficient}
              className="pl-7"
              {...register('amountChips')}
            />
          </div>
        </FormField>

        {/* Indicador de equivalente en ARS */}
        {selectedMethod && computedFiat && (
          <div className="px-3 py-2 border border-[var(--color-success)] bg-[var(--color-success-bg)] text-[12px] text-[var(--color-fg)] flex items-center gap-2">
            <ArrowUpToLine className="size-4 text-[var(--color-success)] shrink-0" />
            Vas a recibir ≈ <strong className="tabular-nums">${Number(computedFiat).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> ARS
          </div>
        )}
      </form>
    </Modal>
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
  if (err.status === 409) {
    if (err.code === 'INSUFFICIENT_BALANCE') {
      return 'No tenés saldo suficiente para esta operación.';
    }
    if (err.code === 'TOO_MANY_PENDING_WITHDRAWALS') {
      return 'Ya tenés retiros pendientes. Esperá la resolución.';
    }
    return err.message || 'Conflicto al procesar.';
  }
  if (err.status === 400) return err.message || 'Datos inválidos.';
  if (err.status === 429) return 'Demasiadas solicitudes. Esperá un minuto.';
  return err.message || 'Error inesperado.';
}
