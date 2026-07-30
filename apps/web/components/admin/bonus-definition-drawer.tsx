/**
 * BonusDefinitionDrawer — view + edit de una bonus_definition.
 *
 * Modos: view (default) / edit. Diff inteligente en submit.
 *
 * Campos NO editables (backend tampoco los acepta):
 *   - code, type, fundedByUserId, createdByUserId.
 *
 * Status transitions libres (admin debe poder corregir):
 *   - draft → active → paused → archived (y combinations).
 *   - Pasar a 'archived' es la forma de "borrar" — el endpoint backend
 *     no expone DELETE porque las definitions con bonos otorgados rompen FK.
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Check, Pencil, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import {
  useBonusDefinitionDetail,
  useUpdateBonusDefinition,
  type BonusDefinition,
  type BonusDefinitionStatus,
} from '@/lib/hooks/use-bonuses';
import { cn } from '@/lib/cn';

const STATUS_OPTIONS: { value: BonusDefinitionStatus; label: string }[] = [
  { value: 'draft', label: 'Borrador' },
  { value: 'active', label: 'Activa' },
  { value: 'paused', label: 'Pausada' },
  { value: 'archived', label: 'Archivada' },
];

const STATUS_VARIANT: Record<BonusDefinitionStatus, BadgeVariant> = {
  draft: 'neutral',
  active: 'success',
  paused: 'warning',
  archived: 'neutral',
};

const STATUS_LABEL: Record<BonusDefinitionStatus, string> = {
  draft: 'borrador',
  active: 'activa',
  paused: 'pausada',
  archived: 'archivada',
};

const schema = z.object({
  name: z
    .string()
    .min(3, 'Mínimo 3 caracteres.')
    .max(120, 'Máximo 120 caracteres.'),
  status: z.enum(['draft', 'active', 'paused', 'archived']),
  expirationDays: z
    .string()
    .min(1, 'Requerido.')
    .regex(/^\d+$/, 'Solo dígitos.')
    .refine((v) => {
      const n = Number(v);
      return n >= 1 && n <= 3650;
    }, 'Entre 1 y 3650 días.'),
  configJson: z
    .string()
    .optional()
    .or(z.literal(''))
    .refine((v) => !v || isValidJson(v), { message: 'JSON inválido.' }),
  wageringJson: z
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

function parseJsonOpt(v?: string): Record<string, unknown> | undefined {
  if (!v || v.trim() === '') return undefined;
  try {
    const parsed = JSON.parse(v);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* validado por zod */
  }
  return undefined;
}

interface BonusDefinitionDrawerProps {
  definitionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BonusDefinitionDrawer({
  definitionId,
  open,
  onOpenChange,
}: BonusDefinitionDrawerProps) {
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const detail = useBonusDefinitionDetail(definitionId);
  const update = useUpdateBonusDefinition(definitionId);
  const { user } = useAuth();
  const canEdit =
    user?.roles?.includes('admin_tenant') ||
    (!!user?.isIndependentBranch);

  useEffect(() => {
    if (!open) setMode('view');
  }, [open]);

  useEffect(() => {
    setMode('view');
  }, [definitionId]);

  const def = detail.data;

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={def?.name ?? 'Definition'}
      subtitle={def ? `${def.code} · ${def.type}` : definitionId ?? '—'}
      footer={
        mode === 'view' && def ? (
          <>
            <Button
              variant="secondary"
              size="md"
              type="button"
              onClick={() => onOpenChange(false)}
            >
              Cerrar
            </Button>
            {canEdit && (
              <Button
                variant="primary"
                size="md"
                type="button"
                onClick={() => setMode('edit')}
              >
                <Pencil className="size-3.5" />
                Editar
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      {detail.isLoading ? (
        <LoadingDetail />
      ) : detail.isError || !def ? (
        <div className="text-[12px] text-[var(--color-fg-subtle)] italic">
          No se pudo cargar la definition.
        </div>
      ) : mode === 'view' ? (
        <ViewMode def={def} />
      ) : (
        <EditMode
          def={def}
          isPending={update.isPending}
          onCancel={() => setMode('view')}
          onSave={async (payload) => {
            try {
              await update.mutateAsync(payload);
              toast.success('Definition actualizada');
              setMode('view');
            } catch (err) {
              toast.error('No se pudo actualizar', { description: mapError(err) });
            }
          }}
        />
      )}
    </Drawer>
  );
}

// ──────────────────────────────────────────────────────────────────────
// View
// ──────────────────────────────────────────────────────────────────────

function ViewMode({ def }: { def: BonusDefinition }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Estado">
          <Badge variant={STATUS_VARIANT[def.status]} dot>
            {STATUS_LABEL[def.status]}
          </Badge>
        </Field>
        <Field label="Tipo">
          <span className="text-[13px] font-mono text-[var(--color-fg)]">
            {def.type}
          </span>
        </Field>
        <Field label="Expira en">
          <span className="text-[13px] font-mono text-[var(--color-fg)]">
            {def.expirationDays} días
          </span>
        </Field>
        <Field label="Funder">
          <span className="text-[10px] font-mono text-[var(--color-fg-subtle)] break-all">
            {def.fundedByUserId}
          </span>
        </Field>
      </div>

      <Field label="Config">
        <JsonBox value={def.config} />
      </Field>

      <Field label="Wagering">
        <JsonBox value={def.wagering} />
      </Field>

      <Field label="Segment filter">
        <JsonBox value={def.segmentFilter} />
      </Field>

      <Field label="Visibility">
        <JsonBox value={def.visibility} />
      </Field>

      <Field label="Creado por">
        <span className="text-[10px] font-mono text-[var(--color-fg-subtle)] break-all">
          {def.createdByUserId}
        </span>
      </Field>

      <Field label="Timestamps">
        <div className="flex flex-col gap-0.5 text-[11px] font-mono text-[var(--color-fg-subtle)]">
          <span>created: {formatFull(def.createdAt)}</span>
          <span>updated: {formatFull(def.updatedAt)}</span>
        </div>
      </Field>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Edit
// ──────────────────────────────────────────────────────────────────────

function EditMode({
  def,
  isPending,
  onCancel,
  onSave,
}: {
  def: BonusDefinition;
  isPending: boolean;
  onCancel: () => void;
  onSave: (payload: {
    name?: string;
    status?: BonusDefinitionStatus;
    expirationDays?: number;
    config?: Record<string, unknown>;
    wagering?: Record<string, unknown>;
  }) => Promise<void>;
}) {
  const defaults = useMemo<FormValues>(
    () => ({
      name: def.name,
      status: def.status,
      expirationDays: String(def.expirationDays),
      configJson: JSON.stringify(def.config, null, 2),
      wageringJson: JSON.stringify(def.wagering, null, 2),
    }),
    [def],
  );

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
    const expirationDaysNum = Number(values.expirationDays);
    await onSave({
      name: values.name !== def.name ? values.name : undefined,
      status:
        values.status !== def.status
          ? (values.status)
          : undefined,
      expirationDays:
        expirationDaysNum !== def.expirationDays ? expirationDaysNum : undefined,
      config: jsonChanged(values.configJson, def.config)
        ? parseJsonOpt(values.configJson)
        : undefined,
      wagering: jsonChanged(values.wageringJson, def.wagering)
        ? parseJsonOpt(values.wageringJson)
        : undefined,
    });
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <FormField id="bdd-name" label="Nombre" required error={errors.name?.message}>
        <Input
          id="bdd-name"
          type="text"
          invalid={!!errors.name}
          {...register('name')}
        />
      </FormField>

      <FormField
        id="bdd-status"
        label="Estado"
        required
        error={errors.status?.message}
        hint="'archived' equivale a borrar (las definitions con bonos no se pueden eliminar duro)."
      >
        <Select
          id="bdd-status"
          invalid={!!errors.status}
          {...register('status')}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField
        id="bdd-expiration"
        label="Días para expirar"
        required
        error={errors.expirationDays?.message}
        hint="Entre 1 y 3650."
      >
        <Input
          id="bdd-expiration"
          type="number"
          min={1}
          max={3650}
          step={1}
          invalid={!!errors.expirationDays}
          {...register('expirationDays')}
          className="font-mono w-32"
        />
      </FormField>

      <FormField
        id="bdd-config"
        label="Config (JSON)"
        error={errors.configJson?.message}
      >
        <textarea
          id="bdd-config"
          rows={6}
          aria-invalid={!!errors.configJson}
          className={textareaClass(!!errors.configJson)}
          {...register('configJson')}
        />
      </FormField>

      <FormField
        id="bdd-wagering"
        label="Wagering (JSON)"
        error={errors.wageringJson?.message}
      >
        <textarea
          id="bdd-wagering"
          rows={5}
          aria-invalid={!!errors.wageringJson}
          className={textareaClass(!!errors.wageringJson)}
          {...register('wageringJson')}
        />
      </FormField>

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

function jsonChanged(s: string | undefined, obj: Record<string, unknown>): boolean {
  if (!s) return Object.keys(obj).length > 0;
  try {
    return JSON.stringify(JSON.parse(s)) !== JSON.stringify(obj);
  } catch {
    return false;
  }
}

// ──────────────────────────────────────────────────────────────────────
// Sub-components
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

function JsonBox({ value }: { value: unknown }) {
  let formatted: string;
  try {
    formatted = JSON.stringify(value, null, 2);
  } catch {
    formatted = String(value);
  }
  if (formatted === '{}' || formatted === 'null') {
    return (
      <span className="text-[11px] text-[var(--color-fg-subtle)] italic">vacío</span>
    );
  }
  return (
    <pre className="text-[11px] font-mono leading-relaxed bg-[var(--color-bg)] border border-[var(--color-border)] p-3 overflow-x-auto whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto text-[var(--color-fg)]">
      {formatted}
    </pre>
  );
}

function LoadingDetail() {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full bg-[var(--color-bg-subtle)]" />
      ))}
    </div>
  );
}

function textareaClass(invalid: boolean): string {
  return cn(
    'flex w-full px-3 py-2 resize-y',
    'bg-[var(--color-bg-subtle)] text-[var(--color-fg)]',
    'border border-[var(--color-border)]',
    'placeholder:text-[var(--color-fg-subtle)]',
    'text-[12px] leading-relaxed font-mono',
    'transition-[border-color,box-shadow] duration-150',
    'hover:border-[var(--color-border-strong)]',
    'focus:outline-none focus:border-[var(--color-accent)]',
    'focus:shadow-[0_0_0_3px_var(--color-accent-glow)]',
    invalid && 'border-[var(--color-accent)] shadow-[0_0_0_3px_var(--color-accent-glow)]',
  );
}

function formatFull(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('es-AR', {
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
  if (err.status === 403) return 'No tenés permiso para editar definitions.';
  if (err.status === 400) return err.message || 'Datos inválidos.';
  if (err.status === 404) return 'La definition ya no existe.';
  return err.message || 'Error inesperado.';
}
