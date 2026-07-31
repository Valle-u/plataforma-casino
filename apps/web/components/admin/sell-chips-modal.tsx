/**
 * SellChipsModal — vende fichas a una sucursal independiente.
 *
 * Acción admin-only (`branch.sell_chips`). El backend transfiere fichas DESDE
 * la Casa (`__casa__`) al socio, drenando su stock (docs/17 I-1, LEYES E3/R4).
 *
 * El admin carga cuántas fichas vende y el TOTAL $ que cobra; el precio por
 * ficha se calcula automáticamente (total / fichas). Si no carga total, el
 * backend usa el precio mayorista configurado del socio.
 *
 * Si la Casa no tiene stock suficiente → 409 HOUSE_INSUFFICIENT_STOCK
 * (fondeá el presupuesto de la Casa con inject-budget antes de vender).
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, Coins, Info } from 'lucide-react';
import { useEffect, useRef } from 'react';
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
  useSellBranchChips,
  type BranchListRow,
} from '@/lib/hooks/use-branches';

const schema = z.object({
  amountChips: z
    .string()
    .min(1, 'Requerido.')
    .regex(
      /^(?!0+(?:\.0+)?$)\d+(?:\.\d{1,2})?$/,
      'Monto > 0 con hasta 2 decimales.',
    ),
  amountFiat: z
    .string()
    .optional()
    .or(z.literal(''))
    .refine(
      (v) => !v || /^(?!0+(?:\.0+)?$)\d+(?:\.\d{1,2})?$/.test(v),
      'Total > 0 con hasta 2 decimales.',
    ),
  notes: z.string().max(500).optional().or(z.literal('')),
});

type FormValues = z.infer<typeof schema>;

interface SellChipsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  socio: BranchListRow | null;
}

export function SellChipsModal({ open, onOpenChange, socio }: SellChipsModalProps) {
  const sell = useSellBranchChips(socio?.socioId ?? null);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { amountChips: '', amountFiat: '', notes: '' },
  });

  const idempotencyKeyRef = useRef<string>(newSellIdempotencyKey());
  useEffect(() => {
    if (open) {
      idempotencyKeyRef.current = newSellIdempotencyKey();
      reset();
    }
  }, [open, reset]);

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const configuredPrice = socio ? Number(socio.branchChipsPricePerUnit) : 0;
  const amountRaw = watch('amountChips');
  const amountNum = Number(amountRaw);
  const fiatRaw = watch('amountFiat');
  const fiatNum = Number(fiatRaw);
  const fiatValid = fiatRaw !== '' && Number.isFinite(fiatNum) && fiatNum > 0;
  const perUnitPreview =
    Number.isFinite(amountNum) && amountNum > 0 && fiatValid
      ? (fiatNum / amountNum).toFixed(4)
      : null;
  const fiatPreview =
    Number.isFinite(amountNum) && amountNum > 0 && configuredPrice > 0
      ? (amountNum * configuredPrice).toFixed(2)
      : null;

  const onSubmit = handleSubmit(async (values) => {
    if (!socio) return;
    try {
      const res = await sell.mutateAsync({
        amountChips: values.amountChips,
        amountFiat: values.amountFiat || undefined,
        notes: values.notes || undefined,
        idempotencyKey: idempotencyKeyRef.current,
      });
      toast.success('Fichas vendidas', {
        description: `${res.amountChips} fichas → $${res.amountFiat} (precio ${res.pricePerUnit}/ficha). Nuevo balance del socio: ${res.newBalance}.`,
      });
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error('No se pudo vender', { description: mapError(err) });
    }
  });

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title="Vender fichas"
      description={
        socio
          ? `Transferís fichas desde la Casa a @${socio.username}. Cargá el total $ que le cobrás; el precio por ficha se calcula automáticamente.`
          : undefined
      }
      size="lg"
      footer={
        <>
          <Button
            variant="secondary"
            size="md"
            type="button"
            onClick={() => handleOpenChange(false)}
            disabled={sell.isPending}
          >
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="md"
            type="submit"
            form="sell-chips-form"
            disabled={sell.isPending || !amountRaw}
          >
            {sell.isPending ? (
              <>
                <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                Vendiendo…
              </>
            ) : (
              <>
                <Coins className="size-3.5" />
                Vender fichas
              </>
            )}
          </Button>
        </>
      }
    >
      <form
        id="sell-chips-form"
        onSubmit={onSubmit}
        className="flex flex-col gap-5"
        noValidate
      >
        <div className="flex items-start gap-3 px-3 py-2.5 border border-[var(--color-border)] bg-[var(--color-bg-elevated)] border-l-2 border-l-[var(--color-accent)]">
          <Info className="size-4 text-[var(--color-accent-text)] mt-0.5 shrink-0" />
          <span className="text-[12px] text-[var(--color-fg)] leading-snug">
            La venta <strong>consume stock de la Casa</strong> (la única fuente
            de fichas, LEYES E3). Cargá el <strong>total $</strong> que le
            cobrás al socio; el precio por ficha se calcula solo. El cobro se
            hace <strong>por fuera</strong>, al precio mayorista que definas.
          </span>
        </div>

        <FormField
          id="sc-amount"
          label="Fichas a vender"
          required
          error={errors.amountChips?.message}
          hint={
            fiatPreview
              ? `Al precio mayorista configurado (${configuredPrice.toFixed(4)}/ficha) serían $${fiatPreview}.`
              : 'Ingresá la cantidad de fichas a transferir.'
          }
        >
          <ChipsAmountInput
            id="sc-amount"
            placeholder="0"
            invalid={!!errors.amountChips}
            {...register('amountChips')}
          />
        </FormField>

        <FormField
          id="sc-fiat"
          label="Total $ a cobrar"
          error={errors.amountFiat?.message}
          hint="Cuánto le cobrás al socio por esta venta. Si lo dejás vacío, se usa el precio mayorista configurado."
        >
          <Input
            id="sc-fiat"
            type="text"
            inputMode="decimal"
            invalid={!!errors.amountFiat}
            placeholder="0.00"
            className="font-mono"
            {...register('amountFiat')}
          />
        </FormField>

        {perUnitPreview && (
          <div className="flex items-start gap-3 px-3 py-2.5 border border-[var(--color-border)] bg-[var(--color-bg)] border-l-2 border-l-[var(--color-accent)]">
            <Coins className="size-4 text-[var(--color-accent-text)] mt-0.5 shrink-0" />
            <span className="text-[12px] text-[var(--color-fg)] leading-snug">
              Precio por ficha: <strong className="font-mono">${perUnitPreview}</strong>
            </span>
          </div>
        )}

        {!perUnitPreview && configuredPrice <= 0 && (
          <div className="flex items-start gap-3 px-3 py-2.5 border border-[var(--color-warning)] bg-[var(--color-warning-bg)] border-l-2 border-l-[var(--color-warning)]">
            <AlertTriangle className="size-4 text-[var(--color-warning)] mt-0.5 shrink-0" />
            <span className="text-[12px] text-[var(--color-fg)] leading-snug">
              Cargá el <strong>total $</strong> para calcular el precio por
              ficha (este socio no tiene precio mayorista configurado).
            </span>
          </div>
        )}

        <FormField
          id="sc-notes"
          label="Notas (opcional)"
          error={errors.notes?.message}
          hint="Ej: venta semanal viernes, recarga inicial, etc. Queda en el audit log."
        >
          <Input
            id="sc-notes"
            type="text"
            invalid={!!errors.notes}
            placeholder="ej. venta semanal"
            {...register('notes')}
          />
        </FormField>
      </form>
    </Modal>
  );
}

function newSellIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Array.from({ length: 32 })
    .map(() => Math.floor(Math.random() * 16).toString(16))
    .join('');
}

function mapError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.status === 403) return 'No tenés permiso para vender fichas (admin only).';
  if (err.status === 404) return 'Socio no encontrado.';
  if (err.status === 400) {
    if (err.code === 'BRANCH_PRICE_NOT_CONFIGURED') {
      return 'Falta configurar el precio mayorista del socio.';
    }
    if (err.code === 'BRANCH_INVALID_PRICE') {
      return 'Precio o monto inválido.';
    }
    return err.message || 'Datos inválidos.';
  }
  if (err.status === 409) {
    if (err.code === 'BRANCH_NOT_INDEPENDENT') {
      return 'Este socio no está en modo independiente.';
    }
    if (err.code === 'HOUSE_INSUFFICIENT_STOCK') {
      return 'La Casa no tiene stock suficiente. Fondeá el presupuesto de la Casa e intentá de nuevo.';
    }
    return err.message || 'Conflicto.';
  }
  return err.message || 'Error inesperado.';
}
