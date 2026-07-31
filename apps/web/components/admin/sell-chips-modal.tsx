/**
 * SellChipsModal — vende fichas a una sucursal independiente.
 *
 * Acción admin-only (`branch.sell_chips`). El backend transfiere fichas DESDE
 * la Casa (`__casa__`) al socio, drenando su stock (docs/17 I-1, LEYES E3/R4).
 * El equivalente fiat = fichas × precio mayorista configurado del socio.
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
    defaultValues: { amountChips: '', notes: '' },
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

  const price = socio ? Number(socio.branchChipsPricePerUnit) : 0;
  const amountRaw = watch('amountChips');
  const amountNum = Number(amountRaw);
  const fiatPreview =
    Number.isFinite(amountNum) && amountNum > 0 && price > 0
      ? (amountNum * price).toFixed(2)
      : null;

  const onSubmit = handleSubmit(async (values) => {
    if (!socio) return;
    try {
      const res = await sell.mutateAsync({
        amountChips: values.amountChips,
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
          ? `Transferís fichas desde la Casa a @${socio.username} al precio mayorista configurado.`
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
            de fichas, LEYES E3). El socio recibe las fichas y vos cobrás el
            equivalente fiat <strong>por fuera</strong>, al precio mayorista
            configurado.
          </span>
        </div>

        <FormField
          id="sc-amount"
          label="Fichas a vender"
          required
          error={errors.amountChips?.message}
          hint={
            fiatPreview
              ? `Equivale a $${fiatPreview} al precio ${price.toFixed(4)}/ficha.`
              : `Precio mayorista: ${price.toFixed(4)}/ficha.`
          }
        >
          <ChipsAmountInput
            id="sc-amount"
            placeholder="0"
            invalid={!!errors.amountChips}
            {...register('amountChips')}
          />
        </FormField>

        {price <= 0 && (
          <div className="flex items-start gap-3 px-3 py-2.5 border border-[var(--color-warning)] bg-[var(--color-warning-bg)] border-l-2 border-l-[var(--color-warning)]">
            <AlertTriangle className="size-4 text-[var(--color-warning)] mt-0.5 shrink-0" />
            <span className="text-[12px] text-[var(--color-fg)] leading-snug">
              Este socio <strong>no tiene precio mayorista configurado</strong>.
              Configuralo desde el detalle del usuario antes de venderle.
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
