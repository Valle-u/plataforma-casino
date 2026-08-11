/**
 * EditTemplateDrawer — editor de subject/body para un kind de notification.
 *
 * Diseño:
 *   - Si NO hay override: subject/body arrancan vacíos. El admin escribe el
 *     custom y guarda → crea override. Botón "Reset" no aparece (no hay
 *     nada que resetear).
 *   - Si HAY override: subject/body pre-cargados + toggle enabled.
 *     Botones: Guardar / Reset (DELETE override → vuelve al default) /
 *     Cancelar.
 *   - Preview: botón "Preview" arma un payload de prueba JSON editable
 *     y muestra el render del draft o del override actual.
 *
 * Variables: el sistema usa `{{ variable }}` mustache-like. La UI no
 * autocompleta (no tenemos schema del payload por kind), pero el preview
 * muestra el error si una variable no resuelve.
 */

'use client';

import { Check, Eye, RotateCcw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { isApiError } from '@/lib/api-client';
import {
  useDeleteTemplate,
  usePreviewTemplate,
  useUpsertTemplate,
  type TemplateOverrideRow,
  type TemplatePreviewResponse,
} from '@/lib/hooks/use-notification-templates';
import { cn } from '@/lib/cn';

interface EditTemplateDrawerProps {
  kind: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentOverride: TemplateOverrideRow | undefined;
}

export function EditTemplateDrawer({
  kind,
  open,
  onOpenChange,
  currentOverride,
}: EditTemplateDrawerProps) {
  // subject/body/payload: NO controlados (ref) — se leen solo al guardar o al
  // renderizar preview (botones), no en cada tecla. Evita perder el foco en
  // Opera. Se pre-cargan con defaultValue + key={kind} para refrescar al cambiar
  // de template.
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const previewPayloadRef = useRef<HTMLTextAreaElement>(null);
  const DEFAULT_PAYLOAD =
    '{\n  "user": { "username": "demo_user", "displayName": "Demo User" }\n}';
  const [enabled, setEnabled] = useState(true);
  const [previewResult, setPreviewResult] = useState<TemplatePreviewResponse | null>(
    null,
  );
  const [previewError, setPreviewError] = useState<string | null>(null);

  const upsert = useUpsertTemplate();
  const remove = useDeleteTemplate();
  const preview = usePreviewTemplate();

  // Sync cuando se abre con otro kind/override. subject/body van por defaultValue
  // + key={kind} (no acá); solo el toggle enabled y el reset del preview.
  useEffect(() => {
    setEnabled(currentOverride ? currentOverride.enabled : true);
    setPreviewResult(null);
    setPreviewError(null);
  }, [kind, currentOverride]);

  if (!kind) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} title="Template">
        <div className="text-[12px] text-[var(--color-fg-subtle)] italic">
          Sin kind seleccionado.
        </div>
      </Drawer>
    );
  }

  const handleSave = async () => {
    const subject = subjectRef.current?.value ?? '';
    const body = bodyRef.current?.value ?? '';
    if (subject.trim() === '' || body.trim() === '') {
      toast.error('Subject y body son obligatorios');
      return;
    }
    try {
      await upsert.mutateAsync({
        kind,
        subjectTemplate: subject,
        bodyTemplate: body,
        enabled,
      });
      toast.success('Override guardado', { description: kind });
      onOpenChange(false);
    } catch (err) {
      toast.error('No se pudo guardar', { description: mapError(err) });
    }
  };

  const handleReset = async () => {
    try {
      await remove.mutateAsync(kind);
      toast.success('Override eliminado · default activo', { description: kind });
      onOpenChange(false);
    } catch (err) {
      toast.error('No se pudo resetear', { description: mapError(err) });
    }
  };

  const handlePreview = async () => {
    setPreviewError(null);
    setPreviewResult(null);
    const subject = subjectRef.current?.value ?? '';
    const body = bodyRef.current?.value ?? '';
    const previewPayload = previewPayloadRef.current?.value ?? DEFAULT_PAYLOAD;
    let payload: Record<string, unknown>;
    try {
      const parsed = JSON.parse(previewPayload);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('payload debe ser un object JSON');
      }
      payload = parsed as Record<string, unknown>;
    } catch (e) {
      setPreviewError(`JSON inválido: ${(e as Error).message}`);
      return;
    }
    try {
      const res = await preview.mutateAsync({
        kind,
        payload,
        // Si hay draft (subject+body no vacíos), preview del draft.
        // Sino el backend usa override actual o default.
        subjectTemplate: subject.trim() || undefined,
        bodyTemplate: body.trim() || undefined,
      });
      setPreviewResult(res);
    } catch (err) {
      setPreviewError(mapError(err));
    }
  };

  const isPending = upsert.isPending || remove.isPending;
  const hasOverride = !!currentOverride;

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={kind}
      subtitle={hasOverride ? 'override activo · custom' : 'sin override · default activo'}
      footer={
        <>
          <Button
            variant="secondary"
            size="md"
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            <X className="size-3.5" />
            Cancelar
          </Button>
          {hasOverride && (
            <Button
              variant="ghost"
              size="md"
              type="button"
              onClick={handleReset}
              disabled={isPending}
              title="Borrar override → vuelve al default hardcoded"
            >
              <RotateCcw className="size-3.5" />
              Reset
            </Button>
          )}
          <Button
            variant="primary"
            size="md"
            type="button"
            onClick={handleSave}
            disabled={isPending}
          >
            {upsert.isPending ? (
              <>
                <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                Guardando…
              </>
            ) : (
              <>
                <Check className="size-3.5" />
                {hasOverride ? 'Actualizar' : 'Crear override'}
              </>
            )}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {/* Status chip + enabled toggle */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {hasOverride ? (
              <Badge variant="success">custom</Badge>
            ) : (
              <Badge variant="neutral">default</Badge>
            )}
            <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] font-mono">
              variables: {`{{ user.username }}`}, etc.
            </span>
          </div>
          <EnabledToggle value={enabled} onChange={setEnabled} />
        </div>

        <FormField
          id="tpl-subject"
          label="Subject template"
          required
          hint="Soporta variables {{ ... }}. Una línea."
        >
          <Input
            id="tpl-subject"
            key={`subj-${kind}`}
            type="text"
            ref={subjectRef}
            defaultValue={currentOverride?.subjectTemplate ?? ''}
            placeholder="Tu depósito #{{ deposit.id }} fue aprobado"
            className="font-mono"
          />
        </FormField>

        <FormField
          id="tpl-body"
          label="Body template"
          required
          hint="Multi-line. Variables idem subject."
        >
          <textarea
            id="tpl-body"
            key={`body-${kind}`}
            rows={8}
            ref={bodyRef}
            defaultValue={currentOverride?.bodyTemplate ?? ''}
            placeholder="Hola {{ user.displayName }},&#10;&#10;Tu depósito de {{ deposit.amountChips }} FICHAS fue aprobado..."
            className={textareaClass(false)}
          />
        </FormField>

        {/* Preview */}
        <div className="flex flex-col gap-2 pt-2 border-t border-[var(--color-border)]">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] font-medium">
              Preview
            </span>
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={handlePreview}
              disabled={preview.isPending}
            >
              {preview.isPending ? (
                <>
                  <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                  Renderizando…
                </>
              ) : (
                <>
                  <Eye className="size-3.5" />
                  Renderizar
                </>
              )}
            </Button>
          </div>

          <FormField
            id="tpl-payload"
            label="Payload de prueba (JSON)"
            error={previewError ?? undefined}
            hint="Object con las variables que el template referencia."
          >
            <textarea
              id="tpl-payload"
              key={`payload-${kind}`}
              rows={4}
              ref={previewPayloadRef}
              defaultValue={DEFAULT_PAYLOAD}
              className={textareaClass(!!previewError)}
            />
          </FormField>

          {previewResult && (
            <div className="flex flex-col gap-2 mt-2">
              <div className="flex items-center gap-2">
                <Badge variant="info">{previewResult.source}</Badge>
                <span className="text-[10px] text-[var(--color-fg-subtle)] font-mono">
                  fuente del render
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)]">
                  Subject
                </span>
                <div className="px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] text-[12px] text-[var(--color-fg)]">
                  {previewResult.subject}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)]">
                  Body
                </span>
                <pre className="px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] text-[12px] font-sans whitespace-pre-wrap break-words max-h-[260px] overflow-y-auto text-[var(--color-fg)]">
                  {previewResult.body}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}

function EnabledToggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-px bg-[var(--color-border)] border border-[var(--color-border)]">
      {[true, false].map((opt) => (
        <button
          key={String(opt)}
          type="button"
          onClick={() => onChange(opt)}
          className={cn(
            'px-3 h-7 text-[10px] uppercase tracking-[0.08em] font-medium font-mono',
            'transition-colors duration-150',
            value === opt
              ? opt
                ? 'bg-[var(--color-success-bg)] text-[var(--color-success)]'
                : 'bg-[var(--color-warning-bg)] text-[var(--color-warning)]'
              : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)]',
          )}
        >
          {opt ? 'enabled' : 'disabled'}
        </button>
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

function mapError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.status === 400) return err.message || 'Datos inválidos.';
  if (err.status === 403) return 'No tenés permiso.';
  if (err.status === 404) return 'Kind no encontrado.';
  return err.message || 'Error inesperado.';
}
