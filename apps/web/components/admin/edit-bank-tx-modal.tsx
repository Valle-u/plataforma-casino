/**
 * EditBankTxModal — editar una transferencia bancaria AÚN sin matchear.
 *
 * Espeja los campos del form de upload, pre-cargados con la transferencia.
 * El backend (`PATCH /tenant/bank-transactions/:id`, permiso `bank_tx.edit`)
 * rechaza con 409 si la transferencia ya fue matcheada — esta UI solo se abre
 * para filas sin matchear, pero el server es la barrera real.
 */

'use client';

import { Save } from 'lucide-react';
import { useEffect, useState } from 'react';
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
  const [form, setForm] = useState(() => emptyForm());

  // Pre-cargar el form cada vez que se abre con una transferencia distinta.
  useEffect(() => {
    if (open && transaction) {
      setForm({
        bankAccount: transaction.bankAccount ?? '',
        amount: transaction.amount,
        currency: transaction.currency,
        direction: transaction.direction,
        senderName: transaction.senderName ?? '',
        senderCbu: transaction.senderCbu ?? '',
        reference: transaction.reference ?? '',
        receivedAt: isoToLocalInput(transaction.receivedAt),
        notes: transaction.notes ?? '',
      });
    }
  }, [open, transaction]);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!transaction) return;
    // Sprint 53: la cuenta solo es obligatoria para entrantes (matcher del
    // deposit). Para salientes con comprobante puede quedar vacía.
    if (form.direction !== 'outgoing' && !form.bankAccount) {
      toast.error('Cuenta obligatoria para transferencias entrantes');
      return;
    }
    if (!form.amount || !form.receivedAt) {
      toast.error('Monto y fecha son obligatorios');
      return;
    }
    try {
      await update.mutateAsync({
        id: transaction.id,
        payload: {
          bankAccount: form.bankAccount.trim() || undefined,
          amount: form.amount,
          currency: form.currency || 'ARS',
          direction: form.direction,
          senderName: form.senderName,
          senderCbu: form.senderCbu,
          reference: form.reference,
          receivedAt: new Date(form.receivedAt).toISOString(),
          notes: form.notes,
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

  const isOutgoing = form.direction === 'outgoing';

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
                onClick={() => set('direction', opt.id)}
                className={cn(
                  'px-3 h-8 text-[11px] uppercase tracking-[0.08em] font-medium transition-colors',
                  form.direction === opt.id
                    ? 'bg-[var(--color-accent)] text-[var(--color-accent-fg)]'
                    : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Cuenta bancaria" required>
          <Input
            value={form.bankAccount}
            onChange={(e) => set('bankAccount', e.target.value)}
            placeholder="CBU/alias"
          />
        </Field>
        <Field label="Monto" required>
          <Input
            value={form.amount}
            onChange={(e) => set('amount', e.target.value.replace(/[^0-9.]/g, ''))}
            placeholder="0.00"
            className="font-mono"
          />
        </Field>
        <Field label="Moneda">
          <Input
            value={form.currency}
            onChange={(e) => set('currency', e.target.value.toUpperCase())}
            placeholder="ARS"
            maxLength={5}
          />
        </Field>
        <Field label="Recibida en" required>
          <Input
            type="datetime-local"
            value={form.receivedAt}
            onChange={(e) => set('receivedAt', e.target.value)}
          />
        </Field>
        <Field label={isOutgoing ? 'Destinatario (nombre)' : 'Remitente (nombre)'}>
          <Input
            value={form.senderName}
            onChange={(e) => set('senderName', e.target.value)}
            placeholder="Juan Pérez"
          />
        </Field>
        <Field label={isOutgoing ? 'Destinatario (CBU/alias)' : 'Remitente (CBU/alias)'}>
          <Input
            value={form.senderCbu}
            onChange={(e) => set('senderCbu', e.target.value)}
            placeholder="opcional"
            className="font-mono"
          />
        </Field>
        <Field label="Referencia / concepto">
          <Input
            value={form.reference}
            onChange={(e) => set('reference', e.target.value)}
            placeholder="lo que dice el extracto"
          />
        </Field>
        <Field label="Notas">
          <Input
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
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

function emptyForm() {
  return {
    bankAccount: '',
    amount: '',
    currency: 'ARS',
    direction: 'incoming' as BankTxDirection,
    senderName: '',
    senderCbu: '',
    reference: '',
    receivedAt: '',
    notes: '',
  };
}

/** ISO (UTC) → valor para <input type="datetime-local"> en hora local. */
function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
