/**
 * WithdrawalOnBehalfModal — retiro EN NOMBRE de un jugador que no supo hacer
 * la solicitud self-service.
 *
 * A diferencia del unload manual (que dejaba un adjustment y aparecía como
 * "corrección"), esto pasa por el flujo de retiro REAL → type 'withdrawal' +
 * burn (E6). Cuenta como retiro en las estadísticas de pago.
 *
 * Dos acciones:
 *   - "Registrar retiro" (un paso): crea + paga declarando la transferencia
 *     saliente con comprobante obligatorio (Sprint 52) → POST on-behalf-paid.
 *   - "Crear pendiente": crea el retiro en la cola normal (para cuando la
 *     transferencia todavía no se hizo) → POST on-behalf.
 *
 * Regla de inputs en modales (Opera): los campos van no controlados vía RHF
 * register; los chips de motivo usan setValue.
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowUpToLine,
  Check,
  CheckCircle2,
  Clock,
  FileText,
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
import { cn } from '@/lib/cn';
import { arDatetimeLocalToIso, isoToArDatetimeLocal } from '@/lib/format-date';
import { fiatFromChips } from '@/lib/ratio';
import { useUploadBankTxProof } from '@/lib/hooks/use-bank-transactions';
import { usePaymentMethods } from '@/lib/hooks/use-payment-methods';
import {
  newPayInFullIdempotencyKey,
  useCreateOnBehalfPaidWithdrawal,
  useCreateOnBehalfWithdrawal,
} from '@/lib/hooks/use-withdrawals';
import { type TenantUserRow } from '@/lib/hooks/use-users';

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const AMOUNT_REGEX = /^(?!0+(?:\.0+)?$)\d+(?:\.\d{1,2})?$/;

const REASON_PRESETS = [
  'Retiro cargado por el operador a pedido del jugador',
  'El jugador no puede acceder a su cuenta',
];

const schema = z.object({
  methodId: z.string().min(1, 'Elegí un método.'),
  cuentaDestino: z.string().min(4, 'Ingresá el CBU/alias del jugador.').max(120),
  amountChips: z
    .string()
    .min(1, 'Requerido.')
    .regex(AMOUNT_REGEX, 'Monto > 0 con hasta 2 decimales.'),
  reason: z.string().min(3, 'Mínimo 3 caracteres.').max(500),
  amount: z.string().regex(AMOUNT_REGEX, 'Monto > 0 con hasta 2 decimales.'),
  receivedAt: z.string().min(1, 'Requerido.'),
  senderName: z.string().max(200).optional().or(z.literal('')),
  notes: z.string().max(500).optional().or(z.literal('')),
  overrideReason: z.string().max(500).optional().or(z.literal('')),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: TenantUserRow;
  onSuccess?: () => void;
  /** Volver al modo "corrección / reverso" (unload) del modal anterior. */
  onBackToCorrection?: () => void;
}

export function WithdrawalOnBehalfModal({
  open,
  onOpenChange,
  target,
  onSuccess,
  onBackToCorrection,
}: Props) {
  const methodsQuery = usePaymentMethods(true);
  const transferMethods = useMemo(
    () =>
      (methodsQuery.data?.data ?? []).filter(
        (m) => m.isActive && m.type === 'bank_transfer',
      ),
    [methodsQuery.data],
  );

  const upload = useUploadBankTxProof();
  const createPaid = useCreateOnBehalfPaidWithdrawal();
  const createPending = useCreateOnBehalfWithdrawal();

  const idempotencyKeyRef = useRef<string | null>(null);
  const ensureIdempotencyKey = () => {
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = newPayInFullIdempotencyKey();
    }
    return idempotencyKeyRef.current;
  };

  const [proof, setProof] = useState<{
    file: File;
    previewUrl: string;
    receiptUrl: string;
    receiptStorageKey: string;
    receiptHash: string;
  } | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    watch,
    getValues,
    setValue,
    trigger,
    formState: { errors },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      methodId: '',
      cuentaDestino: '',
      amountChips: '',
      reason: REASON_PRESETS[0],
      amount: '',
      receivedAt: isoToArDatetimeLocal(new Date()),
      senderName: target.displayName ?? target.username ?? '',
      notes: '',
      overrideReason: '',
    },
  });

  const methodId = watch('methodId');
  const amountChips = watch('amountChips');
  const amount = watch('amount');
  const reasonValue = watch('reason') ?? '';

  // Fiat esperado del método (mismo cálculo que el backend). Sirve para
  // prellenar el monto transferido y detectar diferencias (override).
  const selectedMethod = transferMethods.find((m) => m.id === methodId);
  const expectedFiat =
    selectedMethod && AMOUNT_REGEX.test(amountChips)
      ? fiatFromChips(amountChips, selectedMethod.chipsPerUnit)
      : '';
  const amountsDiffer =
    !!amount && !!expectedFiat && Number(amount) !== Number(expectedFiat);

  const clearProof = () => {
    if (proof?.previewUrl) URL.revokeObjectURL(proof.previewUrl);
    setProof(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const resetAll = () => {
    reset();
    clearProof();
    setProofError(null);
    idempotencyKeyRef.current = null;
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) resetAll();
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
    if (proof?.previewUrl) URL.revokeObjectURL(proof.previewUrl);
    try {
      const res = await upload.mutateAsync(file);
      setProof({
        file,
        previewUrl: URL.createObjectURL(file),
        receiptUrl: res.receiptUrl,
        receiptStorageKey: res.receiptStorageKey,
        receiptHash: res.receiptHash,
      });
    } catch (err) {
      setProofError(mapUploadError(err));
    }
  };

  // Prellenar el monto transferido cuando cambia fichas/método (si el operador
  // no lo tocó manualmente aún).
  const applyExpectedAmount = () => {
    const m = transferMethods.find((x) => x.id === getValues('methodId'));
    const chips = getValues('amountChips');
    if (m && AMOUNT_REGEX.test(chips)) {
      setValue('amount', fiatFromChips(chips, m.chipsPerUnit), {
        shouldValidate: true,
      });
    }
  };

  const submitPaid = handleSubmit(async (values) => {
    if (!proof) {
      setProofError('Subí el comprobante de la transferencia para continuar.');
      return;
    }
    try {
      const equal = !!expectedFiat && Number(values.amount) === Number(expectedFiat);
      await createPaid.mutateAsync({
        payload: {
          targetUserId: target.id,
          methodId: values.methodId,
          amountChips: values.amountChips,
          currencyFiat: 'ARS',
          targetAccount: { cbu: values.cuentaDestino.trim() },
          reason: values.reason.trim(),
          amount: values.amount,
          currency: 'ARS',
          receivedAt:
            arDatetimeLocalToIso(values.receivedAt) ??
            new Date(values.receivedAt).toISOString(),
          senderName: values.senderName?.trim() || undefined,
          receiptUrl: proof.receiptUrl,
          receiptStorageKey: proof.receiptStorageKey,
          receiptHash: proof.receiptHash,
          notes: values.notes?.trim() || undefined,
          override: !equal,
          overrideReason: !equal ? values.overrideReason?.trim() : undefined,
        },
        idempotencyKey: ensureIdempotencyKey(),
      });
      toast.success('Retiro registrado y pagado', {
        description: `${values.amountChips} fichas retiradas de ${target.displayName || target.username}.`,
      });
      handleOpenChange(false);
      onSuccess?.();
    } catch (err) {
      idempotencyKeyRef.current = null;
      toast.error('No se pudo registrar el retiro', { description: mapError(err) });
    }
  });

  const submitPending = async () => {
    const ok = await trigger(['methodId', 'cuentaDestino', 'amountChips', 'reason']);
    if (!ok) return;
    const values = getValues();
    try {
      await createPending.mutateAsync({
        targetUserId: target.id,
        methodId: values.methodId,
        amountChips: values.amountChips,
        currencyFiat: 'ARS',
        targetAccount: { cbu: values.cuentaDestino.trim() },
        reason: values.reason.trim(),
      });
      toast.success('Retiro creado', {
        description: 'Quedó en “Por pagar” para procesar la transferencia.',
      });
      handleOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast.error('No se pudo crear el retiro', { description: mapError(err) });
    }
  };

  const isBusy = createPaid.isPending || createPending.isPending || upload.isPending;

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      title="Retiro del jugador"
      description="Registralo como un retiro real (cuenta como retiro, no como corrección). Declarás la transferencia al jugador y se quema el saldo."
      size="md"
      footer={
        <>
          <Button
            variant="secondary"
            size="md"
            type="button"
            onClick={() => void submitPending()}
            disabled={isBusy}
            title="Queda en 'Por pagar' para procesar la transferencia después"
          >
            <Clock className="size-3.5" />
            Dejar para pagar
          </Button>
          <Button
            variant="primary"
            size="md"
            type="submit"
            form="wob-form"
            disabled={isBusy || !proof}
            title={!proof ? 'Subí el comprobante para habilitar el pago' : undefined}
            className="bg-[var(--color-success)] hover:bg-[#166534] border-[var(--color-success)]"
          >
            {createPaid.isPending ? (
              <>
                <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                Registrando…
              </>
            ) : (
              <>
                <CheckCircle2 className="size-3.5" />
                Registrar retiro
              </>
            )}
          </Button>
        </>
      }
    >
      <form id="wob-form" onSubmit={submitPaid} className="flex flex-col gap-4" noValidate>
        {/* Encabezado con el jugador */}
        <div className="flex items-center gap-3 px-4 py-3 bg-[var(--color-bg)] border border-[var(--color-border)] border-l-2 border-l-[var(--color-accent)]">
          <ArrowUpToLine className="size-4 text-[var(--color-accent-text)] shrink-0" />
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)]">
              Retiro de
            </span>
            <span className="text-[14px] text-[var(--color-fg)] truncate">
              {target.displayName || target.username}
            </span>
          </div>
          {onBackToCorrection && (
            <button
              type="button"
              onClick={onBackToCorrection}
              className="ml-auto text-[11px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] underline shrink-0"
            >
              Es una corrección →
            </button>
          )}
        </div>

        {/* Método + monto en fichas */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField
            id="wob-method"
            label="Método de pago"
            required
            error={errors.methodId?.message}
            hint={
              transferMethods.length === 0
                ? 'No hay métodos de transferencia activos.'
                : 'Transferencia bancaria.'
            }
          >
            <select
              id="wob-method"
              className={cn(
                'w-full h-10 px-3 rounded-[var(--radius-sm)] border bg-[var(--color-bg)] text-[14px] text-[var(--color-fg)]',
                errors.methodId
                  ? 'border-[var(--color-danger)]'
                  : 'border-[var(--color-border)]',
              )}
              {...register('methodId', { onChange: () => applyExpectedAmount() })}
            >
              <option value="">Elegí un método…</option>
              {transferMethods.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField
            id="wob-chips"
            label="Monto en fichas"
            required
            error={errors.amountChips?.message}
            hint="Se quema del saldo del jugador."
          >
            <Input
              id="wob-chips"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              invalid={!!errors.amountChips}
              {...register('amountChips', { onBlur: () => applyExpectedAmount() })}
            />
          </FormField>
        </div>

        {/* Cuenta destino */}
        <FormField
          id="wob-account"
          label="Cuenta destino del jugador"
          required
          error={errors.cuentaDestino?.message}
          hint="CBU o alias a donde se transfiere el dinero."
        >
          <Input
            id="wob-account"
            type="text"
            placeholder="CBU / alias"
            invalid={!!errors.cuentaDestino}
            {...register('cuentaDestino')}
          />
        </FormField>

        {/* Motivo — chips + personalizado */}
        <FormField
          id="wob-reason"
          label="Motivo"
          required
          error={errors.reason?.message}
          hint="Queda en el audit log y se le notifica al jugador."
        >
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-1.5">
              {REASON_PRESETS.map((preset) => {
                const active = reasonValue.trim() === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() =>
                      setValue('reason', preset, {
                        shouldValidate: true,
                        shouldDirty: true,
                      })
                    }
                    className={cn(
                      'rounded-full border px-3 py-1 text-[12px] transition-colors',
                      active
                        ? 'border-[var(--color-accent-border)] bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)]'
                        : 'border-[var(--color-border)] text-[var(--color-fg-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-fg)]',
                    )}
                  >
                    {preset}
                  </button>
                );
              })}
            </div>
            <Input
              id="wob-reason"
              type="text"
              placeholder="O escribí un motivo personalizado…"
              invalid={!!errors.reason}
              {...register('reason')}
            />
          </div>
        </FormField>

        <div className="h-px bg-[var(--color-border)]" />

        <p className="text-[11px] text-[var(--color-fg-subtle)] -mt-1">
          Para <strong>registrar el pago ahora</strong> completá la transferencia
          y el comprobante. Si todavía no transferiste, usá{' '}
          <strong>Dejar para pagar</strong> (queda en “Por pagar”).
        </p>

        {/* Monto transferido + fecha */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField
            id="wob-amount"
            label="Monto transferido"
            required
            error={errors.amount?.message}
            hint={expectedFiat ? `Esperado: ${expectedFiat}` : 'Moneda real.'}
          >
            <Input
              id="wob-amount"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              invalid={!!errors.amount}
              {...register('amount')}
            />
          </FormField>
          <FormField
            id="wob-date"
            label="Fecha de la transferencia"
            required
            error={errors.receivedAt?.message}
          >
            <Input
              id="wob-date"
              type="datetime-local"
              invalid={!!errors.receivedAt}
              {...register('receivedAt')}
            />
          </FormField>
        </div>

        {amountsDiffer && (
          <>
            <div className="flex items-start gap-2 px-3 py-2.5 border border-[var(--color-warning)] bg-[var(--color-warning-bg)] text-[12px] text-[var(--color-warning)]">
              <TriangleAlert className="size-4 mt-0.5 shrink-0" />
              <span>
                El monto transferido difiere del esperado ({expectedFiat}). Explicá
                el motivo del override.
              </span>
            </div>
            <FormField
              id="wob-override"
              label="Motivo del override"
              required
              error={errors.overrideReason?.message}
              hint="Ej: comisión bancaria descontada en destino (mínimo 5 caracteres)."
            >
              <Input
                id="wob-override"
                type="text"
                invalid={!!errors.overrideReason}
                {...register('overrideReason')}
              />
            </FormField>
          </>
        )}

        {/* Comprobante */}
        <FormField
          id="wob-receipt"
          label="Comprobante de la transferencia"
          required
          error={proofError ?? undefined}
          hint="JPG, PNG, WEBP o PDF — máx 5 MB. Obligatorio para registrar el pago."
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
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'flex flex-col items-center justify-center gap-2 px-4 py-6 border-2 border-dashed transition-colors cursor-pointer',
                isDragOver
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent-subtle)]'
                  : 'border-[var(--color-border-strong)] bg-[var(--color-bg-subtle)] hover:border-[var(--color-accent)] hover:bg-[var(--color-bg)]',
              )}
            >
              <input
                ref={fileInputRef}
                id="wob-receipt"
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
                  <span className="text-[12px] text-[var(--color-fg-muted)]">Subiendo…</span>
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
            <div className="flex items-start gap-3 p-3 bg-[var(--color-bg)] border border-[var(--color-success)] border-l-2 border-l-[var(--color-success)]">
              <div className="size-14 shrink-0 bg-[var(--color-bg-subtle)] border border-[var(--color-border)] overflow-hidden flex items-center justify-center">
                {proof.file.type.startsWith('image/') ? (
                  <img src={proof.previewUrl} alt="preview" className="size-full object-cover" />
                ) : (
                  <FileText className="size-6 text-[var(--color-fg-subtle)]" />
                )}
              </div>
              <div className="flex flex-col gap-1 flex-1 min-w-0">
                <span className="text-[12px] text-[var(--color-fg)] font-medium truncate">
                  {proof.file.name}
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] text-[var(--color-success)]">
                  <Check className="size-3" strokeWidth={3} />
                  Subido correctamente
                </span>
              </div>
              <button
                type="button"
                onClick={clearProof}
                className="size-7 flex items-center justify-center text-[var(--color-fg-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-bg-subtle)] transition-colors"
                aria-label="Quitar"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}
        </FormField>
      </form>
    </Modal>
  );
}

function mapUploadError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión al subir el comprobante.';
  if (err.status === 413) return 'El archivo supera el tamaño máximo (5MB).';
  if (err.status === 415) return 'Tipo de archivo no permitido (JPG, PNG, WEBP o PDF).';
  if (err.status === 403) return 'No tenés permiso para subir comprobantes (bank_tx.upload).';
  return err.message || 'No se pudo subir el comprobante.';
}

function mapError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.status === 403) {
    if (err.code === 'OUT_OF_SCOPE') return 'El jugador no está dentro de tu red.';
    return 'No tenés permiso (se necesitan withdrawals.process + bank_tx.upload + bank_tx.match).';
  }
  if (err.status === 409) {
    if (err.code === 'BANK_TX_DUPLICATE_REF' || err.code === 'RECEIPT_DUPLICATE')
      return 'Ese comprobante ya se usó — subí otro.';
    if (err.code === 'TOO_MANY_PENDING_WITHDRAWALS')
      return 'El jugador ya tiene demasiados retiros en curso.';
    if (err.code === 'INSUFFICIENT_BALANCE')
      return 'El jugador no tiene saldo disponible suficiente.';
    return 'Conflicto al procesar.';
  }
  if (err.status === 400) {
    if (err.code === 'WITHDRAWAL_TARGET_NOT_PLAYER')
      return 'El destinatario no es un jugador.';
    if (err.code === 'BANK_TX_AMOUNT_MISMATCH')
      return 'El monto no coincide — revisalo o completá el motivo del override.';
    if (err.code === 'BANK_TX_OUTGOING_RECEIPT_REQUIRED')
      return 'El comprobante es obligatorio.';
    if (err.code === 'WITHDRAWAL_BELOW_MINIMUM')
      return 'El monto está por debajo del mínimo de retiro.';
    return err.message || 'Datos inválidos.';
  }
  if (err.status === 429) return 'Demasiadas cargas en poco tiempo — esperá unos segundos.';
  return err.message || 'Error inesperado.';
}
