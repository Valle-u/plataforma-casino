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
import {
  ArrowDownToLine,
  Check,
  Copy,
  FileImage,
  FileText,
  ShieldAlert,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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
  useCreateDeposit,
  useUploadDepositProof,
  type CreateDepositPayload,
} from '@/lib/hooks/use-deposits';
import {
  usePaymentMethods,
  type PaymentMethod,
} from '@/lib/hooks/use-payment-methods';
import { chipsFromFiat } from '@/lib/ratio';
import { cn } from '@/lib/cn';

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);
const MAX_FILE_SIZE = 5 * 1024 * 1024;

const AMOUNT_REGEX = /^(?!0+(?:\.0+)?$)\d+(?:\.\d{1,2})?$/;

const schema = z.object({
  methodId: z.string().uuid('Seleccioná un método de pago.'),
  amountFiat: z
    .string()
    .min(1, 'Requerido.')
    .regex(AMOUNT_REGEX, 'Monto > 0 con hasta 2 decimales.'),
  currencyFiat: z.enum(['ARS', 'USDT', 'USD', 'BRL']),
});

type FormValues = z.infer<typeof schema>;

interface NewDepositModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewDepositModal({ open, onOpenChange }: NewDepositModalProps) {
  const methods = usePaymentMethods(true);
  const create = useCreateDeposit();
  const upload = useUploadDepositProof();

  // Sprint 51.6: comprobante obligatorio. Subimos al endpoint
  // /upload-proof apenas el cliente elige archivo, guardamos la URL +
  // storageKey en state, y los enviamos junto con el create-deposit.
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
    formState: { errors },
    reset,
    watch,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      methodId: '',
      amountFiat: '',
      currencyFiat: 'ARS',
    },
  });

  useEffect(() => {
    if (!open) {
      reset();
      if (proof?.previewUrl) URL.revokeObjectURL(proof.previewUrl);
      setProof(null);
      setProofError(null);
    }
     
  }, [open, reset]);

  const selectedMethodId = watch('methodId');
  const selectedMethod = methods.data?.data.find((m) => m.id === selectedMethodId);
  // Parte B: las fichas se calculan del ratio del método (preview; el server
  // es el autoritativo). monto_fiat × chips_per_unit.
  const amountFiatWatch = watch('amountFiat');
  const computedChips =
    selectedMethod && amountFiatWatch && AMOUNT_REGEX.test(amountFiatWatch)
      ? chipsFromFiat(amountFiatWatch, selectedMethod.chipsPerUnit)
      : null;

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
      setProofError(mapError(err));
    }
  };

  const clearProof = (): void => {
    if (proof?.previewUrl) URL.revokeObjectURL(proof.previewUrl);
    setProof(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const onSubmit = handleSubmit(async (values) => {
    if (!proof) {
      setProofError('Subí un comprobante de pago para continuar.');
      return;
    }
    const payload: CreateDepositPayload = {
      methodId: values.methodId,
      amountFiat: values.amountFiat,
      currencyFiat: values.currencyFiat,
      // El server recalcula del ratio; mandamos el preview por compatibilidad.
      amountChips: selectedMethod
        ? chipsFromFiat(values.amountFiat, selectedMethod.chipsPerUnit)
        : values.amountFiat,
      receiptUrl: proof.receiptUrl,
      receiptStorageKey: proof.receiptStorageKey,
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
            disabled={
              create.isPending ||
              methods.isLoading ||
              upload.isPending ||
              !proof
            }
            title={
              !proof
                ? 'Subí un comprobante para habilitar el envío'
                : undefined
            }
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
            <ShieldAlert className="size-4 text-[var(--color-accent-text)] mt-0.5 shrink-0" />
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
          label="Fichas a acreditar"
          hint={
            selectedMethod
              ? `Se calculan solas: monto × ${selectedMethod.chipsPerUnit} (ratio del método).`
              : 'Elegí un método y un monto para ver las fichas.'
          }
        >
          <div className="flex items-center h-9 px-3 border border-[var(--color-border)] bg-[var(--color-bg-subtle)] font-mono text-[14px]">
            {computedChips ? (
              <span className="text-[var(--color-fg)]">
                {Number(computedChips).toLocaleString('es-AR', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{' '}
                <span className="text-[10px] text-[var(--color-fg-subtle)]">
                  FICHAS
                </span>
              </span>
            ) : (
              <span className="text-[12px] text-[var(--color-fg-subtle)]">—</span>
            )}
          </div>
        </FormField>

        {/* Sprint 51.6: upload obligatorio del comprobante (drag-drop). */}
        <FormField
          id="dep-receipt-file"
          label="Comprobante de pago"
          required
          error={proofError ?? undefined}
          hint="JPG, PNG, WEBP o PDF — máx 5 MB. Una foto clara del comprobante de tu transferencia."
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
                id="dep-receipt-file"
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
