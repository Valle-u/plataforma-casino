/**
 * PayInFullModal — "Pago completo" de un retiro en un solo paso (Fase 2).
 *
 * En UNA operación el operador financiero declara la transferencia
 * saliente YA ejecutada (bankAccount, monto, comprobante obligatorio,
 * fecha), la matchea con el retiro y lo marca como pagado. Es el atajo
 * mobile de la secuencia clásica Sprint 51 (cargar bank_tx → matchear →
 * marcar pagado).
 *
 * Sprint 52: el comprobante de pago es obligatorio. Se sube primero al
 * endpoint `/tenant/bank-transactions/upload-proof` (two-step, igual que
 * los depósitos) y se manda `receiptUrl` + `receiptStorageKey` en el
 * payload. El mismo comprobante no puede reutilizarse en otra bank_tx.
 *
 * Idempotencia: una key por apertura del modal, reutilizada en reintentos.
 * Si el monto transferido difiere del amount_fiat del retiro (comisión
 * bancaria), el backend exige `override` + motivo — el form lo muestra
 * automáticamente.
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  Check,
  CheckCircle2,
  FileImage,
  FileText,
  Send,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { isApiError } from '@/lib/api-client';
import { useUploadBankTxProof } from '@/lib/hooks/use-bank-transactions';
import {
  newPayInFullIdempotencyKey,
  usePayInFullWithdrawal,
  type WithdrawalRow,
} from '@/lib/hooks/use-withdrawals';
import { cn } from '@/lib/cn';

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);
const MAX_FILE_SIZE = 5 * 1024 * 1024;

const AMOUNT_REGEX = /^(?!0+(?:\.0+)?$)\d+(?:\.\d{1,2})?$/;

/** Schema construido por retiro: el override es obligatorio si el monto
 *  transferido difiere del amount_fiat del retiro. */
function buildSchema(amountFiat: string) {
  return z
    .object({
      bankAccount: z.string().min(1, 'Requerido.').max(100, 'Máximo 100 caracteres.'),
      amount: z
        .string()
        .min(1, 'Requerido.')
        .regex(AMOUNT_REGEX, 'Monto > 0 con hasta 2 decimales.'),
      currency: z.string().min(1).max(10, 'Máximo 10 caracteres.'),
      receivedAt: z.string().min(1, 'Requerido.'),
      senderName: z.string().max(200).optional().or(z.literal('')),
      notes: z.string().max(500).optional().or(z.literal('')),
      overrideReason: z.string().max(500).optional().or(z.literal('')),
    })
    .superRefine((data, ctx) => {
      const equal = Number(data.amount) === Number(amountFiat);
      if (equal) return;
      const reason = data.overrideReason?.trim() ?? '';
      if (!reason) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['overrideReason'],
          message: 'El monto difiere del retiro — explicá el motivo (mínimo 5 caracteres).',
        });
      } else if (reason.length < 5) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['overrideReason'],
          message: 'Motivo del override: mínimo 5 caracteres.',
        });
      }
    });
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

interface PayInFullModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  withdrawal: WithdrawalRow;
  onSuccess?: () => void;
}

export function PayInFullModal({
  open,
  onOpenChange,
  withdrawal,
  onSuccess,
}: PayInFullModalProps) {
  const payInFull = usePayInFullWithdrawal(withdrawal.id);
  const upload = useUploadBankTxProof();
  const schema = useMemo(
    () => buildSchema(withdrawal.amountFiat),
    [withdrawal.amountFiat],
  );
  // Idempotencia: una key por apertura, reutilizada en reintentos.
  const idempotencyKeyRef = useRef<string | null>(null);
  const ensureIdempotencyKey = () => {
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = newPayInFullIdempotencyKey();
    }
    return idempotencyKeyRef.current;
  };

  // Sprint 52: comprobante obligatorio (two-step igual que los depósitos).
  const [proof, setProof] = useState<{
    file: File;
    previewUrl: string;
    receiptUrl: string;
    receiptStorageKey: string;
  } | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      bankAccount: '',
      amount: withdrawal.amountFiat,
      currency: withdrawal.currencyFiat,
      receivedAt: toDatetimeLocal(new Date()),
      senderName: withdrawal.userDisplayName ?? withdrawal.userUsername ?? '',
      notes: '',
      overrideReason: '',
    },
  });

  const amount = watch('amount');
  const amountsDiffer = Number(amount) !== Number(withdrawal.amountFiat);

  const resetForm = () => {
    reset({
      amount: withdrawal.amountFiat,
      currency: withdrawal.currencyFiat,
      receivedAt: toDatetimeLocal(new Date()),
      senderName: withdrawal.userDisplayName ?? withdrawal.userUsername ?? '',
      notes: '',
      overrideReason: '',
    });
    clearProof();
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      resetForm();
      idempotencyKeyRef.current = null;
    }
    onOpenChange(next);
  };

  const handleFile = async (file: File): Promise<void> => {
    setProofError(null);
    if (!ALLOWED_MIME.has(file.type)) {
      setProofError(`Tipo no permitido (${file.type}). Usá JPG, PNG, WEBP o PDF.`);
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setProofError(
        `El archivo pesa ${(file.size / 1024 / 1024).toFixed(1)}MB — el máx es 5MB.`,
      );
      return;
    }
    // Liberar preview anterior si existía.
    if (proof?.previewUrl) URL.revokeObjectURL(proof.previewUrl);
    try {
      const res = await upload.mutateAsync(file);
      const previewUrl = URL.createObjectURL(file);
      setProof({
        file,
        previewUrl,
        receiptUrl: res.receiptUrl,
        receiptStorageKey: res.receiptStorageKey,
      });
    } catch (err) {
      setProofError(mapUploadError(err));
    }
  };

  const clearProof = (): void => {
    if (proof?.previewUrl) URL.revokeObjectURL(proof.previewUrl);
    setProof(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const onSubmit = handleSubmit(async (values) => {
    if (!proof) {
      setProofError('Subí el comprobante de la transferencia para continuar.');
      return;
    }
    try {
      const equal = Number(values.amount) === Number(withdrawal.amountFiat);
      await payInFull.mutateAsync({
        payload: {
          bankAccount: values.bankAccount.trim(),
          amount: values.amount,
          currency: values.currency.trim(),
          receivedAt: new Date(values.receivedAt).toISOString(),
          senderName: values.senderName?.trim() || undefined,
          receiptUrl: proof.receiptUrl,
          receiptStorageKey: proof.receiptStorageKey,
          notes: values.notes?.trim() || undefined,
          override: !equal,
          overrideReason: !equal ? values.overrideReason?.trim() : undefined,
        },
        idempotencyKey: ensureIdempotencyKey(),
      });
      toast.success('Retiro pagado en un solo paso', {
        description: `${withdrawal.amountChips} fichas debitadas del usuario.`,
      });
      handleOpenChange(false);
      onSuccess?.();
    } catch (err) {
      // Si el usuario corrigió el form tras un error de validación del
      // servidor, regeneramos la key para no reusar un intent fallido.
      if (idempotencyKeyRef.current) idempotencyKeyRef.current = null;
      toast.error('No se pudo registrar el pago', { description: mapError(err) });
    }
  });

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title="Pago completo"
      description="Declarás la transferencia saliente, la matcheás y marcás el retiro como pagado — todo en una sola operación."
      size="md"
      footer={
        <>
          <Button
            variant="secondary"
            size="md"
            type="button"
            onClick={() => handleOpenChange(false)}
            disabled={payInFull.isPending}
          >
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="md"
            type="submit"
            form="pay-in-full-form"
            disabled={payInFull.isPending || upload.isPending || !proof}
            title={
              !proof
                ? 'Subí el comprobante para habilitar el pago'
                : undefined
            }
            className="bg-[var(--color-success)] hover:bg-[#166534] border-[var(--color-success)]"
          >
            {payInFull.isPending ? (
              <>
                <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                Pagando…
              </>
            ) : (
              <>
                <CheckCircle2 className="size-3.5" />
                Confirmar pago
              </>
            )}
          </Button>
        </>
      }
    >
      <form
        id="pay-in-full-form"
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
        noValidate
      >
        {/* Resumen */}
        <div className="flex items-center gap-3 px-4 py-3 bg-[var(--color-bg)] border border-[var(--color-border)]">
          <Send className="size-4 text-[var(--color-success)] shrink-0" />
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)]">
              Retiro de
            </span>
            <span className="font-mono text-[15px] tabular-nums text-[var(--color-fg)]">
              {withdrawal.amountFiat}{' '}
              <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
                {withdrawal.currencyFiat}
              </span>
              <span className="text-[11px] text-[var(--color-fg-muted)]">
                {' '}
                · {withdrawal.amountChips} FICHAS
              </span>
            </span>
          </div>
        </div>

        {/* Aviso de override */}
        {amountsDiffer && (
          <div className="flex items-start gap-2 px-3 py-2.5 border border-[var(--color-warning)] bg-[var(--color-warning-bg)] text-[12px] text-[var(--color-warning)]">
            <TriangleAlert className="size-4 mt-0.5 shrink-0" />
            <span>
              El monto transferido difiere del retiro (
              {withdrawal.amountFiat} {withdrawal.currencyFiat}). El backend
              exige un motivo de override.
            </span>
          </div>
        )}

        <FormField
          id="pif-account"
          label="Cuenta bancaria de origen"
          required
          error={errors.bankAccount?.message}
          hint="CBU / cuenta de la que salió la transferencia."
        >
          <Input
            id="pif-account"
            type="text"
            invalid={!!errors.bankAccount}
            placeholder="0000000000000000000000"
            className="font-mono"
            {...register('bankAccount')}
          />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField
            id="pif-amount"
            label="Monto transferido"
            required
            error={errors.amount?.message}
            hint="Moneda real, hasta 2 decimales."
          >
            <Input
              id="pif-amount"
              type="text"
              inputMode="decimal"
              invalid={!!errors.amount}
              {...register('amount')}
            />
          </FormField>
          <FormField
            id="pif-currency"
            label="Moneda"
            required
            error={errors.currency?.message}
          >
            <Input
              id="pif-currency"
              type="text"
              maxLength={10}
              invalid={!!errors.currency}
              {...register('currency')}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField
            id="pif-receivedAt"
            label="Fecha de la transferencia"
            required
            error={errors.receivedAt?.message}
          >
            <Input
              id="pif-receivedAt"
              type="datetime-local"
              invalid={!!errors.receivedAt}
              {...register('receivedAt')}
            />
          </FormField>
          <FormField
            id="pif-sender"
            label="Destinatario"
            error={errors.senderName?.message}
            hint="Opcional."
          >
            <Input
              id="pif-sender"
              type="text"
              invalid={!!errors.senderName}
              {...register('senderName')}
            />
          </FormField>
        </div>

        {/* Sprint 52: comprobante obligatorio (drag-drop). */}
        <FormField
          id="pif-receipt-file"
          label="Comprobante de la transferencia"
          required
          error={proofError ?? undefined}
          hint="JPG, PNG, WEBP o PDF — máx 5 MB. Foto clara del comprobante de salida."
        >
          {!proof ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOver(false);
                const file = e.dataTransfer.files[0];
                if (file) void handleFile(file);
              }}
              className={cn(
                'flex flex-col items-center justify-center gap-2 px-4 py-8 border-2 border-dashed transition-colors cursor-pointer',
                isDragOver
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent-subtle)]'
                  : 'border-[var(--color-border-strong)] bg-[var(--color-bg-subtle)] hover:border-[var(--color-accent)] hover:bg-[var(--color-bg)]',
              )}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                id="pif-receipt-file"
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFile(file);
                }}
              />
              {upload.isPending ? (
                <>
                  <span className="size-5 border-2 border-[var(--color-accent)] border-r-transparent animate-spin rounded-full" />
                  <span className="text-[12px] text-[var(--color-fg-muted)]">
                    Subiendo…
                  </span>
                </>
              ) : (
                <>
                  <Upload className="size-5 text-[var(--color-fg-subtle)]" />
                  <span className="text-[12px] text-[var(--color-fg)]">
                    Arrastrá o hacé clic para seleccionar
                  </span>
                  <span className="text-[10px] text-[var(--color-fg-subtle)]">
                    JPG · PNG · WEBP · PDF (máx 5 MB)
                  </span>
                </>
              )}
            </div>
          ) : (
            <ProofPreview
              file={proof.file}
              previewUrl={proof.previewUrl}
              onClear={clearProof}
            />
          )}
        </FormField>

        {amountsDiffer && (
          <FormField
            id="pif-override"
            label="Motivo del override"
            required
            error={errors.overrideReason?.message}
            hint="Ej: comisión bancaria descontada en destino."
          >
            <Input
              id="pif-override"
              type="text"
              invalid={!!errors.overrideReason}
              {...register('overrideReason')}
            />
          </FormField>
        )}

        <FormField
          id="pif-notes"
          label="Notas"
          error={errors.notes?.message}
          hint="Opcional. Detalle interno (no se muestra al usuario)."
        >
          <Input
            id="pif-notes"
            type="text"
            invalid={!!errors.notes}
            {...register('notes')}
          />
        </FormField>
      </form>
    </Modal>
  );
}

function ProofPreview({
  file,
  previewUrl,
  onClear,
}: {
  file: File;
  previewUrl: string;
  onClear: () => void;
}) {
  const isImage = file.type.startsWith('image/');
  return (
    <div className="flex items-start gap-3 p-3 bg-[var(--color-bg)] border border-[var(--color-success)] border-l-2 border-l-[var(--color-success)]">
      <div className="size-16 shrink-0 bg-[var(--color-bg-subtle)] border border-[var(--color-border)] overflow-hidden flex items-center justify-center">
        {isImage ? (
          <img
            src={previewUrl}
            alt="preview"
            className="size-full object-cover"
          />
        ) : (
          <FileText className="size-6 text-[var(--color-fg-subtle)]" />
        )}
      </div>
      <div className="flex flex-col gap-1 flex-1 min-w-0">
        <span className="text-[12px] text-[var(--color-fg)] font-medium truncate">
          {file.name}
        </span>
        <span className="text-[10px] text-[var(--color-fg-muted)] flex items-center gap-2">
          {isImage ? (
            <FileImage className="size-3" />
          ) : (
            <FileText className="size-3" />
          )}
          {(file.size / 1024).toFixed(0)} KB · {file.type}
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] text-[var(--color-success)]">
          <Check className="size-3" strokeWidth={3} />
          Subido correctamente
        </span>
      </div>
      <button
        type="button"
        onClick={onClear}
        className="size-7 flex items-center justify-center text-[var(--color-fg-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-bg-subtle)] transition-colors"
        aria-label="Quitar"
        title="Quitar y subir otro"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function mapUploadError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión al subir el comprobante.';
  if (err.status === 413) return 'El archivo supera el tamaño máximo (5MB).';
  if (err.status === 415) return 'Tipo de archivo no permitido (JPG, PNG, WEBP o PDF).';
  if (err.status === 403) return 'No tenés permiso para subir comprobantes (se necesita bank_tx.upload).';
  return err.message || 'No se pudo subir el comprobante.';
}

function mapError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.status === 403) return 'No tenés permiso (se necesitan withdrawals.process + bank_tx.upload + bank_tx.match).';
  if (err.status === 404) return 'El retiro ya no existe.';
  if (err.status === 409) {
    if (err.code === 'BANK_TX_DUPLICATE_REF')
      return 'Ese comprobante ya se usó en otra transferencia — subí otro.';
    return 'El retiro ya fue resuelto por otro operador.';
  }
  if (err.status === 400) {
    if (err.code === 'BANK_TX_AMOUNT_MISMATCH')
      return 'El monto no coincide con el retiro — revisá el monto o completá el motivo del override.';
    if (err.code === 'BANK_TX_OUTGOING_RECEIPT_REQUIRED')
      return 'El comprobante es obligatorio para transferencias salientes.';
    if (err.code === 'WITHDRAWAL_REQUIRES_BANK_TX')
      return 'Este retiro ya tiene una transferencia matcheada — usá "Marcar pagado".';
    return err.message || 'Datos inválidos.';
  }
  if (err.status === 429) return 'Demasiadas cargas en poco tiempo — esperá unos segundos.';
  return err.message || 'Error inesperado.';
}
