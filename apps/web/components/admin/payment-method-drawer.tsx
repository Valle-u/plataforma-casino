/**
 * PaymentMethodDrawer — view + edit del payment method.
 *
 * View: muestra code/name/type/status + config como key-value list + timestamps.
 * Edit: name + isActive + config dinámico por type (mismo pattern que Create).
 *
 * Acción adicional: "Archivar" (toggle isActive=false) — irreversible
 * desde UI (re-activar requiere ir a tab "Inactivos" y editar). El admin
 * confirma con ConfirmModal.
 *
 * `code` y `type` NO editables (backend tampoco los acepta en PATCH).
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Archive, Check, Pencil, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { Drawer } from '@/components/ui/drawer';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiError } from '@/lib/api-client';
import {
  useArchivePaymentMethod,
  usePaymentMethodDetail,
  useUpdatePaymentMethod,
  type PaymentMethod,
} from '@/lib/hooks/use-payment-methods';
import { cn } from '@/lib/cn';

const schema = z.object({
  name: z.string().min(3, 'Mínimo 3.').max(120, 'Máximo 120.'),
  isActive: z.boolean(),
  chipsPerUnit: z.coerce
    .number({ invalid_type_error: 'Ingresá un número.' })
    .min(0.0001, 'Mayor a 0.')
    .max(1_000_000, 'Demasiado alto.'),
  // Bank fields.
  cbu: z.string().max(60).optional().or(z.literal('')),
  alias: z.string().max(60).optional().or(z.literal('')),
  beneficiario: z.string().max(120).optional().or(z.literal('')),
  banco: z.string().max(120).optional().or(z.literal('')),
  // Crypto fields.
  network: z.string().max(40).optional().or(z.literal('')),
  address: z.string().max(200).optional().or(z.literal('')),
  memo: z.string().max(200).optional().or(z.literal('')),
  // Other (JSON raw).
  configJson: z
    .string()
    .optional()
    .or(z.literal(''))
    .refine((v) => !v || isValidJson(v), { message: 'JSON inválido.' }),
});

type FormValues = z.infer<typeof schema>;

function isValidJson(v: string): boolean {
  try {
    JSON.parse(v);
    return true;
  } catch {
    return false;
  }
}

function buildConfig(
  type: PaymentMethod['type'],
  values: FormValues,
): Record<string, unknown> {
  if (type === 'bank_transfer') {
    const cfg: Record<string, unknown> = {};
    if (values.cbu) cfg.cbu = values.cbu;
    if (values.alias) cfg.alias = values.alias;
    if (values.beneficiario) cfg.beneficiario = values.beneficiario;
    if (values.banco) cfg.banco = values.banco;
    return cfg;
  }
  if (type === 'crypto') {
    const cfg: Record<string, unknown> = {};
    if (values.network) cfg.network = values.network;
    if (values.address) cfg.address = values.address;
    if (values.memo) cfg.memo = values.memo;
    return cfg;
  }
  if (values.configJson && values.configJson.trim() !== '') {
    try {
      const parsed = JSON.parse(values.configJson);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* zod ya validó */
    }
  }
  return {};
}

interface PaymentMethodDrawerProps {
  methodId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PaymentMethodDrawer({
  methodId,
  open,
  onOpenChange,
}: PaymentMethodDrawerProps) {
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [confirmArchive, setConfirmArchive] = useState(false);
  const detail = usePaymentMethodDetail(methodId);
  const update = useUpdatePaymentMethod(methodId);
  const archive = useArchivePaymentMethod(methodId);

  useEffect(() => {
    if (!open) setMode('view');
  }, [open]);

  useEffect(() => {
    setMode('view');
  }, [methodId]);

  const method = detail.data;

  return (
    <>
      <Drawer
        open={open}
        onOpenChange={onOpenChange}
        title={method?.name ?? 'Método de pago'}
        subtitle={
          method ? `${method.code} · ${method.type}` : methodId ?? '—'
        }
        footer={
          mode === 'view' && method ? (
            <>
              <Button
                variant="secondary"
                size="md"
                type="button"
                onClick={() => onOpenChange(false)}
              >
                Cerrar
              </Button>
              {method.isActive && (
                <Button
                  variant="ghost"
                  size="md"
                  type="button"
                  onClick={() => setConfirmArchive(true)}
                >
                  <Archive className="size-3.5" />
                  Archivar
                </Button>
              )}
              <Button
                variant="primary"
                size="md"
                type="button"
                onClick={() => setMode('edit')}
              >
                <Pencil className="size-3.5" />
                Editar
              </Button>
            </>
          ) : undefined
        }
      >
        {detail.isLoading ? (
          <LoadingDetail />
        ) : detail.isError || !method ? (
          <div className="text-[12px] text-[var(--color-fg-subtle)] italic">
            No se pudo cargar el método.
          </div>
        ) : mode === 'view' ? (
          <ViewMode method={method} />
        ) : (
          <EditMode
            method={method}
            isPending={update.isPending}
            onCancel={() => setMode('view')}
            onSave={async (payload) => {
              try {
                await update.mutateAsync(payload);
                toast.success('Método actualizado');
                setMode('view');
              } catch (err) {
                toast.error('No se pudo actualizar', {
                  description: mapError(err),
                });
              }
            }}
          />
        )}
      </Drawer>

      <ConfirmModal
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title="Archivar método"
        description={
          method
            ? `${method.code} dejará de aparecer en el dropdown de depósitos/retiros del jugador.`
            : ''
        }
        warning="Los deposits/withdrawals históricos referenciados a este método NO se afectan — siguen referenciables. Para re-activar después, editalo y poné isActive=true."
        confirmLabel="Archivar"
        confirmIcon={<Archive className="size-3.5" />}
        confirmVariant="outline-accent"
        onConfirm={async () => {
          try {
            await archive.mutateAsync();
            toast.success('Método archivado');
            setConfirmArchive(false);
            onOpenChange(false);
          } catch (err) {
            toast.error('No se pudo archivar', { description: mapError(err) });
          }
        }}
        isPending={archive.isPending}
      />
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// View
// ──────────────────────────────────────────────────────────────────────

function ViewMode({ method }: { method: PaymentMethod }) {
  const entries = Object.entries(method.config ?? {});
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Estado">
          {method.isActive ? (
            <Badge variant="success" dot>
              activo
            </Badge>
          ) : (
            <Badge variant="neutral" dot>
              archivado
            </Badge>
          )}
        </Field>
        <Field label="Tipo">
          <span className="text-[12px] font-mono text-[var(--color-fg)]">
            {method.type}
          </span>
        </Field>
      </div>

      <Field label="Fichas por unidad (ratio ficha↔plata)">
        <span className="text-[12px] font-mono text-[var(--color-fg)]">
          {method.chipsPerUnit}
        </span>
      </Field>

      <Field label="Config (visible al jugador en deposit modal)">
        {entries.length === 0 ? (
          <span className="text-[11px] text-[var(--color-fg-subtle)] italic">
            Sin datos.
          </span>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {entries.map(([k, v]) => (
              <li
                key={k}
                className="flex items-center justify-between gap-3 px-3 py-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg)]"
              >
                <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-mono">
                  {k}
                </span>
                <span className="text-[12px] font-mono text-[var(--color-fg)] truncate max-w-[60%]">
                  {String(v)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Field>

      <Field label="Timestamps">
        <div className="flex flex-col gap-0.5 text-[11px] font-mono text-[var(--color-fg-subtle)]">
          <span>created: {formatFull(method.createdAt)}</span>
          <span>updated: {formatFull(method.updatedAt)}</span>
        </div>
      </Field>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Edit
// ──────────────────────────────────────────────────────────────────────

function EditMode({
  method,
  isPending,
  onCancel,
  onSave,
}: {
  method: PaymentMethod;
  isPending: boolean;
  onCancel: () => void;
  onSave: (payload: {
    name?: string;
    isActive?: boolean;
    config?: Record<string, unknown>;
    chipsPerUnit?: number;
  }) => Promise<void>;
}) {
  const defaults = useMemo<FormValues>(() => {
    const cfg = method.config ?? {};
    // Sprint 54 lint cleanup: solo aceptamos string primitivo. Si por
    // alguna razón el config JSON tiene un objeto en estos campos, lo
    // ignoramos (evitamos "[object Object]" en el input visible).
    const str = (v: unknown): string => (typeof v === 'string' ? v : '');
    return {
      name: method.name,
      isActive: method.isActive,
      chipsPerUnit: Number(method.chipsPerUnit),
      cbu: str(cfg.cbu),
      alias: str(cfg.alias),
      beneficiario: str(cfg.beneficiario),
      banco: str(cfg.banco),
      network: str(cfg.network),
      address: str(cfg.address),
      memo: str(cfg.memo),
      configJson:
        method.type === 'other' ? JSON.stringify(cfg, null, 2) : '',
    };
  }, [method]);

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  });

  useEffect(() => {
    reset(defaults);
  }, [defaults, reset]);

  const onSubmit = handleSubmit(async (values) => {
    const newConfig = buildConfig(method.type, values);
    await onSave({
      name: values.name !== method.name ? values.name : undefined,
      isActive: values.isActive !== method.isActive ? values.isActive : undefined,
      config: configChanged(newConfig, method.config) ? newConfig : undefined,
      chipsPerUnit:
        values.chipsPerUnit !== Number(method.chipsPerUnit)
          ? values.chipsPerUnit
          : undefined,
    });
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <FormField id="pmd-name" label="Nombre" required error={errors.name?.message}>
        <Input
          id="pmd-name"
          type="text"
          invalid={!!errors.name}
          {...register('name')}
        />
      </FormField>

      <label className="flex items-center gap-2 text-[12px] text-[var(--color-fg)] cursor-pointer select-none">
        <input
          type="checkbox"
          {...register('isActive')}
          className="size-4 accent-[var(--color-accent)] cursor-pointer"
        />
        Activo (visible al jugador)
      </label>

      <FormField
        id="pmd-ratio"
        label="Fichas por unidad"
        required
        error={errors.chipsPerUnit?.message}
        hint="Cuántas fichas vale 1 unidad de la moneda. Ej: pesos → 1; USDT → 1000."
      >
        <Input
          id="pmd-ratio"
          type="number"
          step="0.0001"
          min="0.0001"
          inputMode="decimal"
          className="font-mono"
          invalid={!!errors.chipsPerUnit}
          {...register('chipsPerUnit')}
        />
      </FormField>

      {/* Config dinámico por type */}
      {method.type === 'bank_transfer' && (
        <div className="flex flex-col gap-3 p-3 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)]">
          <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-medium">
            Datos bancarios
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField id="pmd-cbu" label="CBU / CVU">
              <Input
                id="pmd-cbu"
                type="text"
                inputMode="numeric"
                className="font-mono"
                {...register('cbu')}
              />
            </FormField>
            <FormField id="pmd-alias" label="Alias">
              <Input id="pmd-alias" type="text" {...register('alias')} />
            </FormField>
            <FormField id="pmd-beneficiario" label="Titular">
              <Input
                id="pmd-beneficiario"
                type="text"
                {...register('beneficiario')}
              />
            </FormField>
            <FormField id="pmd-banco" label="Banco">
              <Input id="pmd-banco" type="text" {...register('banco')} />
            </FormField>
          </div>
        </div>
      )}

      {method.type === 'crypto' && (
        <div className="flex flex-col gap-3 p-3 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)]">
          <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)] font-medium">
            Wallet
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-3">
            <FormField id="pmd-network" label="Network">
              <Input
                id="pmd-network"
                type="text"
                className="font-mono"
                {...register('network')}
              />
            </FormField>
            <FormField id="pmd-address" label="Address">
              <Input
                id="pmd-address"
                type="text"
                className="font-mono"
                {...register('address')}
              />
            </FormField>
          </div>
          <FormField id="pmd-memo" label="Memo / Tag">
            <Input id="pmd-memo" type="text" {...register('memo')} />
          </FormField>
        </div>
      )}

      {method.type === 'other' && (
        <FormField
          id="pmd-config"
          label="Config (JSON)"
          error={errors.configJson?.message}
        >
          <textarea
            id="pmd-config"
            rows={5}
            aria-invalid={!!errors.configJson}
            className={cn(
              'flex w-full px-3 py-2 resize-y',
              'bg-[var(--color-bg-subtle)] text-[var(--color-fg)]',
              'border border-[var(--color-border)]',
              'text-[12px] leading-relaxed font-mono',
              'transition-[border-color,box-shadow] duration-150',
              'hover:border-[var(--color-border-strong)]',
              'focus:outline-none focus:border-[var(--color-accent)]',
              'focus:shadow-[0_0_0_3px_var(--color-accent-glow)]',
              errors.configJson &&
                'border-[var(--color-accent)] shadow-[0_0_0_3px_var(--color-accent-glow)]',
            )}
            {...register('configJson')}
          />
        </FormField>
      )}

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
        <Button
          variant="secondary"
          size="md"
          type="button"
          onClick={onCancel}
          disabled={isPending}
        >
          <X className="size-3.5" />
          Cancelar
        </Button>
        <Button
          variant="primary"
          size="md"
          type="submit"
          disabled={!isDirty || isPending}
        >
          {isPending ? (
            <>
              <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
              Guardando…
            </>
          ) : (
            <>
              <Check className="size-3.5" />
              Guardar
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

function configChanged(
  next: Record<string, unknown>,
  prev: Record<string, unknown>,
): boolean {
  return JSON.stringify(next) !== JSON.stringify(prev);
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] font-medium">
        {label}
      </span>
      {children}
    </div>
  );
}

function LoadingDetail() {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full bg-[var(--color-bg-subtle)]" />
      ))}
    </div>
  );
}

function formatFull(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function mapError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.status === 403) return 'No tenés permiso para editar métodos.';
  if (err.status === 400) return err.message || 'Datos inválidos.';
  if (err.status === 404) return 'El método ya no existe.';
  return err.message || 'Error inesperado.';
}
