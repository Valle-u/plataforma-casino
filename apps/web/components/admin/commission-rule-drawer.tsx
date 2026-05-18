/**
 * CommissionRuleDrawer — view + edit + archive de una commission rule.
 *
 * Editable:
 *   - pct (mismo regex que en create).
 *   - active (toggle).
 *   - notes.
 *
 * NO editable: role + eventType — son la unique key. Para "cambiar el
 * rol" del payout, el admin archiva esta rule y crea una nueva.
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
  useArchiveCommissionRule,
  useCommissionRuleDetail,
  useUpdateCommissionRule,
  type CommissionRule,
} from '@/lib/hooks/use-commissions';
import { cn } from '@/lib/cn';

const pctRegex = /^(?:100(?:\.00?)?|\d{1,2}(?:\.\d{1,2})?)$/;

const schema = z.object({
  pct: z.string().regex(pctRegex, '0.00 - 100.00 con hasta 2 decimales.'),
  active: z.boolean(),
  notes: z.string().max(500).optional().or(z.literal('')),
});

type FormValues = z.infer<typeof schema>;

interface CommissionRuleDrawerProps {
  ruleId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommissionRuleDrawer({
  ruleId,
  open,
  onOpenChange,
}: CommissionRuleDrawerProps) {
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [confirmArchive, setConfirmArchive] = useState(false);
  const detail = useCommissionRuleDetail(ruleId);
  const update = useUpdateCommissionRule(ruleId);
  const archive = useArchiveCommissionRule(ruleId);

  useEffect(() => {
    if (!open) setMode('view');
  }, [open]);

  useEffect(() => {
    setMode('view');
  }, [ruleId]);

  const rule = detail.data;

  return (
    <>
      <Drawer
        open={open}
        onOpenChange={onOpenChange}
        title={
          rule ? `${rule.role} → ${eventLabel(rule.eventType)}` : 'Regla de comisión'
        }
        subtitle={rule ? `${rule.pct}%` : ruleId ?? '—'}
        footer={
          mode === 'view' && rule ? (
            <>
              <Button
                variant="secondary"
                size="md"
                type="button"
                onClick={() => onOpenChange(false)}
              >
                Cerrar
              </Button>
              {rule.active && (
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
        ) : detail.isError || !rule ? (
          <div className="text-[12px] text-[var(--color-fg-subtle)] italic">
            No se pudo cargar la regla.
          </div>
        ) : mode === 'view' ? (
          <ViewMode rule={rule} />
        ) : (
          <EditMode
            rule={rule}
            isPending={update.isPending}
            onCancel={() => setMode('view')}
            onSave={async (payload) => {
              try {
                await update.mutateAsync(payload);
                toast.success('Regla actualizada');
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
        title="Archivar regla"
        description={
          rule
            ? `${rule.role} dejará de cobrar ${rule.pct}% en eventos "${eventLabel(rule.eventType)}".`
            : ''
        }
        warning="Los payouts ya generados NO se afectan — quedan paid. Solo deja de aplicarse a eventos futuros. Re-activable editándola."
        confirmLabel="Archivar"
        confirmIcon={<Archive className="size-3.5" />}
        confirmVariant="outline-accent"
        onConfirm={async () => {
          try {
            await archive.mutateAsync();
            toast.success('Regla archivada');
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

function ViewMode({ rule }: { rule: CommissionRule }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Rol beneficiario">
          <span className="text-[12px] font-mono text-[var(--color-fg)]">
            {rule.role}
          </span>
        </Field>
        <Field label="Evento">
          <span className="text-[12px] font-mono text-[var(--color-fg)]">
            {rule.eventType}
          </span>
        </Field>
        <Field label="Porcentaje">
          <span className="text-[15px] font-mono text-[var(--color-fg)]">
            {rule.pct}%
          </span>
        </Field>
        <Field label="Estado">
          {rule.active ? (
            <Badge variant="success" dot>
              activa
            </Badge>
          ) : (
            <Badge variant="neutral" dot>
              archivada
            </Badge>
          )}
        </Field>
      </div>

      <Field label="Notas">
        {rule.notes ? (
          <p className="text-[12px] text-[var(--color-fg)] whitespace-pre-wrap">
            {rule.notes}
          </p>
        ) : (
          <span className="text-[11px] text-[var(--color-fg-subtle)] italic">
            Sin notas.
          </span>
        )}
      </Field>

      <Field label="Timestamps">
        <div className="flex flex-col gap-0.5 text-[11px] font-mono text-[var(--color-fg-subtle)]">
          <span>created: {formatFull(rule.createdAt)}</span>
          <span>updated: {formatFull(rule.updatedAt)}</span>
        </div>
      </Field>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Edit
// ──────────────────────────────────────────────────────────────────────

function EditMode({
  rule,
  isPending,
  onCancel,
  onSave,
}: {
  rule: CommissionRule;
  isPending: boolean;
  onCancel: () => void;
  onSave: (payload: {
    pct?: string;
    active?: boolean;
    notes?: string | null;
  }) => Promise<void>;
}) {
  const defaults = useMemo<FormValues>(
    () => ({
      pct: rule.pct,
      active: rule.active,
      notes: rule.notes ?? '',
    }),
    [rule],
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
    const next: { pct?: string; active?: boolean; notes?: string | null } = {};
    if (values.pct !== rule.pct) next.pct = values.pct;
    if (values.active !== rule.active) next.active = values.active;
    const nextNotes = values.notes && values.notes.trim() !== '' ? values.notes : null;
    if (nextNotes !== rule.notes) next.notes = nextNotes;
    await onSave(next);
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <FormField id="crd-pct" label="Porcentaje" required error={errors.pct?.message}>
        <Input
          id="crd-pct"
          type="text"
          inputMode="decimal"
          className="font-mono"
          invalid={!!errors.pct}
          {...register('pct')}
        />
      </FormField>

      <label className="flex items-center gap-2 text-[12px] text-[var(--color-fg)] cursor-pointer select-none">
        <input
          type="checkbox"
          {...register('active')}
          className="size-4 accent-[var(--color-accent)] cursor-pointer"
        />
        Activa (se aplica a eventos futuros)
      </label>

      <FormField id="crd-notes" label="Notas" error={errors.notes?.message}>
        <textarea
          id="crd-notes"
          rows={3}
          className={cn(
            'flex w-full px-3 py-2 resize-y',
            'bg-[var(--color-bg-subtle)] text-[var(--color-fg)]',
            'border border-[var(--color-border)]',
            'text-[12px] leading-relaxed',
            'transition-[border-color,box-shadow] duration-150',
            'hover:border-[var(--color-border-strong)]',
            'focus:outline-none focus:border-[var(--color-accent)]',
            'focus:shadow-[0_0_0_3px_var(--color-accent-glow)]',
          )}
          {...register('notes')}
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
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full bg-[var(--color-bg-subtle)]" />
      ))}
    </div>
  );
}

function eventLabel(t: string): string {
  if (t === 'deposit_approved') return 'Depósito aprobado';
  if (t === 'withdrawal_paid') return 'Retiro pagado';
  return t;
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
  if (err.status === 403) return 'No tenés permiso para configurar comisiones.';
  if (err.status === 400) return err.message || 'Datos inválidos.';
  if (err.status === 404) return 'La regla ya no existe.';
  return err.message || 'Error inesperado.';
}
