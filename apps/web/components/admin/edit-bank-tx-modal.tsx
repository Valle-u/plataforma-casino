/**
 * EditBankTxModal — editar una transferencia bancaria AÚN sin matchear.
 *
 * Sprint 54: espeja el form simplificado de upload — titular y banco de la
 * cuenta propia, monto, fecha/hora, contraparte. Referencia y notas quedan
 * opcionales para corregir datos viejos. Sin CBU ni moneda (fija ARS).
 *
 * El backend (`PATCH /tenant/bank-transactions/:id`, permiso `bank_tx.edit`)
 * rechaza con 409 si la transferencia ya fue matcheada — esta UI solo se abre
 * para filas sin matchear, pero el server es la barrera real.
 */

'use client';

import { Save } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { isApiError } from '@/lib/api-client';
import {
  useUpdateBankTransaction,
  type BankTransaction,
  type BankTxDirection,
} from '@/lib/hooks/use-bank-transactions';
import { cn } from '@/lib/cn';

interface EditBankTxModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: BankTransaction | null;
}

export function EditBankTxModal({
  open,
  onOpenChange,
  transaction,
}: EditBankTxModalProps) {
  const update = useUpdateBankTransaction();
  // Solo `direction` es estado (botones reactivos). Los campos de texto van por
  // ref (no controlados) para no perder el foco al tipear en Opera. Se pre-cargan
  // con defaultValue + key={transaction.id}.
  const [direction, setDirection] = useState<BankTxDirection>('incoming');
  const accountHolderRef = useRef<HTMLInputElement>(null);
  const bankNameRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const senderNameRef = useRef<HTMLInputElement>(null);
  const referenceRef = useRef<HTMLInputElement>(null);
  const receivedAtRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && transaction) setDirection(transaction.direction);
  }, [open, transaction]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!transaction) return;
    const amount = amountRef.current?.value ?? '';
    const receivedAt = receivedAtRef.current?.value ?? '';
    if (!amount || !receivedAt) {
      toast.error('Monto y fecha son obligatorios');
      return;
    }
    try {
      await update.mutateAsync({
        id: transaction.id,
        payload: {
          amount,
          direction,
          accountHolder: accountHolderRef.current?.value.trim() || undefined,
          bankName: bankNameRef.current?.value.trim() || undefined,
          senderName: senderNameRef.current?.value.trim() || undefined,
          reference: referenceRef.current?.value.trim() || undefined,
          receivedAt: new Date(receivedAt).toISOString(),
          notes: notesRef.current?.value.trim() || undefined,
        },
      });
      toast.success('Transferencia actualizada');
      onOpenChange(false);
    } catch (err) {
      toast.error('No se pudo guardar', {
        description: isApiError(err) ? err.message : 'Error de conexión.',
      });
    }
  }

  const isOutgoing = direction === 'outgoing';

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Editar transferencia"
      description="Corregí los datos de esta transferencia sin matchear."
      size="lg"
      footer={
        <>
          <Button
            variant="secondary"
            size="md"
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={update.isPending}
          >
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="md"
            type="submit"
            form="edit-bank-tx-form"
            disabled={update.isPending}
          >
            {update.isPending ? (
              <>
                <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                Guardando…
              </>
            ) : (
              <>
                <Save className="size-3.5" />
                Guardar cambios
              </>
            )}
          </Button>
        </>
      }
    >
      <form
        id="edit-bank-tx-form"
        key={transaction?.id ?? 'new'}
        onSubmit={submit}
        className="grid grid-cols-1 sm:grid-cols-2 gap-3"
        noValidate
      >
        <Field label="Dirección" required>
          <div className="flex items-center gap-px bg-[var(--color-border)] border border-[var(--color-border)] w-fit">
            {(
              [
                { id: 'incoming' as const, label: 'Entrante' },
                { id: 'outgoing' as const, label: 'Saliente' },
              ]
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setDirection(opt.id)}
                className={cn(
                  'px-3 h-8 text-[11px] uppercase tracking-[0.08em] font-medium transition-colors',
                  direction === opt.id
                    ? 'bg-[var(--color-accent)] text-[var(--color-accent-fg)]'
                    : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Titular de la cuenta">
          <Input
            ref={accountHolderRef}
            defaultValue={transaction?.accountHolder ?? ''}
            placeholder="Juan Pérez"
          />
        </Field>
        <Field label="Banco">
          <Input
            ref={bankNameRef}
            defaultValue={transaction?.bankName ?? ''}
            placeholder="Banco Nación"
          />
        </Field>
        <Field label="Monto" required>
          <Input
            ref={amountRef}
            defaultValue={transaction?.amount ?? ''}
            onInput={(e) => {
              const el = e.currentTarget;
              el.value = el.value.replace(/[^0-9.]/g, '');
            }}
            placeholder="0.00"
            className="font-mono"
          />
        </Field>
        <Field label="Recibida en" required>
          <Input
            type="datetime-local"
            ref={receivedAtRef}
            defaultValue={transaction ? isoToLocalInput(transaction.receivedAt) : ''}
          />
        </Field>
        <Field label={isOutgoing ? 'Titular que recibe' : 'Titular que envía'}>
          <Input
            ref={senderNameRef}
            defaultValue={transaction?.senderName ?? ''}
            placeholder="Juan Pérez"
          />
        </Field>
        <Field label="Referencia / concepto">
          <Input
            ref={referenceRef}
            defaultValue={transaction?.reference ?? ''}
            placeholder="lo que dice el extracto"
          />
        </Field>
        <Field label="Notas">
          <Input
            ref={notesRef}
            defaultValue={transaction?.notes ?? ''}
            placeholder="opcional"
          />
        </Field>
      </form>
    </Modal>
  );
}

function Field({
  label,
  children,
  required,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label>
        {label}
        {required && <span className="text-[var(--color-accent-text)]"> *</span>}
      </Label>
      {children}
    </div>
  );
}

/** ISO (UTC) → valor para <input type="datetime-local"> en hora local. */
function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
