/**
 * PromotionDetailDrawer — ver y editar una promoción.
 *
 * Dos modos:
 *   - view (default): muestra todos los campos. Botón "Editar" arriba.
 *   - edit: form con name, status, dates, config/prizes JSON. Save aplica
 *     PATCH; Cancelar vuelve a view sin tocar nada.
 *
 * Transiciones de status están permitidas todas (el backend valida lo
 * coherente). Casos típicos:
 *   - draft → scheduled → active → closed
 *   - * → cancelled (cualquier momento, con audit severity:medium)
 *
 * `code`, `type`, `fundedByUserId`, `createdByUserId` NUNCA cambian.
 */

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Calendar, Check, Pencil, X } from 'lucide-react';
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
import {
  usePromotionDetail,
  useUpdatePromotion,
  type PromotionRow,
  type PromotionStatus,
} from '@/lib/hooks/use-promotions';
import { cn } from '@/lib/cn';

const STATUS_OPTIONS: { value: PromotionStatus; label: string }[] = [
  { value: 'draft', label: 'Borrador' },
  { value: 'scheduled', label: 'Programada' },
  { value: 'active', label: 'Activa' },
  { value: 'closed', label: 'Cerrada' },
  { value: 'cancelled', label: 'Cancelada' },
];

const STATUS_VARIANT: Record<PromotionStatus, BadgeVariant> = {
  draft: 'neutral',
  scheduled: 'info',
  active: 'success',
  closed: 'neutral',
  cancelled: 'danger',
};

const STATUS_LABEL: Record<PromotionStatus, string> = {
  draft: 'borrador',
  scheduled: 'programada',
  active: 'activa',
  closed: 'cerrada',
  cancelled: 'cancelada',
};

const schema = z.object({
  name: z
    .string()
    .min(3, 'Mínimo 3 caracteres.')
    .max(120, 'Máximo 120 caracteres.'),
  status: z.enum(['draft', 'scheduled', 'active', 'closed', 'cancelled']),
  startsAt: z.string().optional().or(z.literal('')),
  endsAt: z.string().optional().or(z.literal('')),
  drawAt: z.string().optional().or(z.literal('')),
  configJson: z
    .string()
    .optional()
    .or(z.literal(''))
    .refine((v) => !v || isValidJson(v), { message: 'JSON inválido.' }),
  prizesJson: z
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
    /* swallowed — validado por zod */
  }
  return undefined;
}

function toLocalInput(iso?: string | null): string {
  if (!iso) return '';
  // datetime-local quiere yyyy-MM-ddTHH:mm sin Z; restamos offset.
  const d = new Date(iso);
  const tz = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 16);
}

function toIsoOrNull(local?: string): string | null {
  if (!local) return null;
  return new Date(local).toISOString();
}

interface PromotionDetailDrawerProps {
  promotionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PromotionDetailDrawer({
  promotionId,
  open,
  onOpenChange,
}: PromotionDetailDrawerProps) {
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const detail = usePromotionDetail(promotionId);
  const update = useUpdatePromotion(promotionId);

  // Reset a view cada vez que cambia el promotion o se cierra.
  useEffect(() => {
    if (!open) setMode('view');
  }, [open]);

  useEffect(() => {
    setMode('view');
  }, [promotionId]);

  const promo = detail.data;

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={promo?.name ?? 'Promoción'}
      subtitle={promo ? `${promo.code} · ${promo.type}` : promotionId ?? '—'}
      footer={
        mode === 'view' && promo ? (
          <>
            <Button
              variant="secondary"
              size="md"
              type="button"
              onClick={() => onOpenChange(false)}
            >
              Cerrar
            </Button>
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
      ) : detail.isError || !promo ? (
        <div className="text-[12px] text-[var(--color-fg-subtle)] italic">
          No se pudo cargar la promoción.
        </div>
      ) : mode === 'view' ? (
        <ViewMode promo={promo} />
      ) : (
        <EditMode
          promo={promo}
          isPending={update.isPending}
          onCancel={() => setMode('view')}
          onSave={async (payload) => {
            try {
              await update.mutateAsync(payload);
              toast.success('Promoción actualizada');
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
// View mode
// ──────────────────────────────────────────────────────────────────────

function ViewMode({ promo }: { promo: PromotionRow }) {
  return (
    <div className="flex flex-col gap-5">
      <Field label="Estado">
        <Badge variant={STATUS_VARIANT[promo.status]} dot>
          {STATUS_LABEL[promo.status]}
        </Badge>
      </Field>

      <Field label="Tipo">
        <span className="text-[13px] font-mono text-[var(--color-fg)]">
          {promo.type}
        </span>
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Empieza">
          <DateLine iso={promo.startsAt} />
        </Field>
        <Field label="Termina">
          <DateLine iso={promo.endsAt} />
        </Field>
      </div>

      {promo.drawAt && (
        <Field label="Sorteo">
          <DateLine iso={promo.drawAt} />
        </Field>
      )}

      <Field label="Funder">
        <span className="text-[11px] font-mono text-[var(--color-fg-subtle)] break-all">
          {promo.fundedByUserId}
        </span>
      </Field>

      <Field label="Creado por">
        <span className="text-[11px] font-mono text-[var(--color-fg-subtle)] break-all">
          {promo.createdByUserId}
        </span>
      </Field>

      <Field label="Config">
        <JsonBox value={promo.config} />
      </Field>

      <Field label="Prizes">
        <JsonBox value={promo.prizes} />
      </Field>

      <Field label="Target segment">
        <JsonBox value={promo.targetSegment} />
      </Field>

      <Field label="Visibility">
        <JsonBox value={promo.visibility} />
      </Field>

      <Field label="Timestamps">
        <div className="flex flex-col gap-0.5 text-[11px] font-mono text-[var(--color-fg-subtle)]">
          <span>created: {formatFull(promo.createdAt)}</span>
          <span>updated: {formatFull(promo.updatedAt)}</span>
        </div>
      </Field>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Edit mode
// ──────────────────────────────────────────────────────────────────────

function EditMode({
  promo,
  isPending,
  onCancel,
  onSave,
}: {
  promo: PromotionRow;
  isPending: boolean;
  onCancel: () => void;
  onSave: (payload: {
    name?: string;
    status?: PromotionStatus;
    startsAt?: string | null;
    endsAt?: string | null;
    drawAt?: string | null;
    config?: Record<string, unknown>;
    prizes?: Record<string, unknown>;
  }) => void | Promise<void>;
}) {
  const defaults = useMemo<FormValues>(
    () => ({
      name: promo.name,
      status: promo.status,
      startsAt: toLocalInput(promo.startsAt),
      endsAt: toLocalInput(promo.endsAt),
      drawAt: toLocalInput(promo.drawAt),
      configJson: JSON.stringify(promo.config, null, 2),
      prizesJson: JSON.stringify(promo.prizes, null, 2),
    }),
    [promo],
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
    await onSave({
      name: values.name !== promo.name ? values.name : undefined,
      status:
        values.status !== promo.status
          ? (values.status as PromotionStatus)
          : undefined,
      startsAt: dateChanged(values.startsAt, promo.startsAt)
        ? toIsoOrNull(values.startsAt)
        : undefined,
      endsAt: dateChanged(values.endsAt, promo.endsAt)
        ? toIsoOrNull(values.endsAt)
        : undefined,
      drawAt: dateChanged(values.drawAt, promo.drawAt)
        ? toIsoOrNull(values.drawAt)
        : undefined,
      config: jsonChanged(values.configJson, promo.config)
        ? parseJsonOpt(values.configJson)
        : undefined,
      prizes: jsonChanged(values.prizesJson, promo.prizes)
        ? parseJsonOpt(values.prizesJson)
        : undefined,
    });
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <FormField id="pd-name" label="Nombre" required error={errors.name?.message}>
        <Input
          id="pd-name"
          type="text"
          invalid={!!errors.name}
          {...register('name')}
        />
      </FormField>

      <FormField
        id="pd-status"
        label="Estado"
        required
        error={errors.status?.message}
        hint="Cambiar a 'cancelled' es irreversible para los users; el audit lo registra."
      >
        <Select
          id="pd-status"
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

      <div className="grid grid-cols-1 gap-4">
        <FormField id="pd-starts" label="Empieza" error={errors.startsAt?.message}>
          <Input
            id="pd-starts"
            type="datetime-local"
            invalid={!!errors.startsAt}
            {...register('startsAt')}
          />
        </FormField>
        <FormField id="pd-ends" label="Termina" error={errors.endsAt?.message}>
          <Input
            id="pd-ends"
            type="datetime-local"
            invalid={!!errors.endsAt}
            {...register('endsAt')}
          />
        </FormField>
        <FormField id="pd-draw" label="Sorteo" error={errors.drawAt?.message}>
          <Input
            id="pd-draw"
            type="datetime-local"
            invalid={!!errors.drawAt}
            {...register('drawAt')}
          />
        </FormField>
      </div>

      <FormField id="pd-config" label="Config (JSON)" error={errors.configJson?.message}>
        <textarea
          id="pd-config"
          rows={6}
          aria-invalid={!!errors.configJson}
          className={textareaClass(!!errors.configJson)}
          {...register('configJson')}
        />
      </FormField>

      <FormField id="pd-prizes" label="Prizes (JSON)" error={errors.prizesJson?.message}>
        <textarea
          id="pd-prizes"
          rows={5}
          aria-invalid={!!errors.prizesJson}
          className={textareaClass(!!errors.prizesJson)}
          {...register('prizesJson')}
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

function dateChanged(local: string | undefined, iso: string | null): boolean {
  const newIso = toIsoOrNull(local);
  return (newIso ?? null) !== (iso ?? null);
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

function DateLine({ iso }: { iso: string | null }) {
  if (!iso)
    return (
      <span className="text-[12px] text-[var(--color-fg-subtle)] italic">—</span>
    );
  return (
    <div className="flex items-center gap-1.5 text-[12px] text-[var(--color-fg)] font-mono">
      <Calendar className="size-3 text-[var(--color-fg-subtle)]" />
      {formatFull(iso)}
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
  if (err.status === 403) return 'No tenés permiso para editar promociones.';
  if (err.status === 400) return err.message || 'Datos inválidos.';
  if (err.status === 404) return 'La promoción ya no existe.';
  return err.message || 'Error inesperado.';
}
