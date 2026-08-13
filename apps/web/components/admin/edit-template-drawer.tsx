/**
 * EditTemplateDrawer — editor amigable del texto de un aviso automático.
 *
 * Muestra: (1) el nombre en criollo + cuándo se envía, (2) el "texto actual"
 * (cómo lo ven hoy los jugadores, renderizado con datos de ejemplo), (3) un
 * editor de Asunto + Cuerpo con chips de variables que insertan {{...}} por vos,
 * y una vista previa en vivo. Guardar = usar tu texto; Volver = usar el que
 * viene. Inputs NO controlados (ref) — regla de modales (Opera).
 */

'use client';

import { Check, Eye, RotateCcw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
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
} from '@/lib/hooks/use-notification-templates';
import { getKindMeta } from '@/lib/notification-kinds-meta';
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
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const lastFocused = useRef<'subject' | 'body'>('body');

  const [currentText, setCurrentText] = useState<{ subject: string; body: string } | null>(null);
  const [draftPreview, setDraftPreview] = useState<{ subject: string; body: string } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const upsert = useUpsertTemplate();
  const remove = useDeleteTemplate();
  const preview = usePreviewTemplate();

  const meta = kind ? getKindMeta(kind) : null;
  const hasOverride = !!currentOverride;

  // Al abrir: renderizar el "texto actual" (efectivo hoy) con datos de ejemplo.
  useEffect(() => {
    setDraftPreview(null);
    setPreviewError(null);
    setCurrentText(null);
    if (!kind || !open || !meta) return;
    let cancel = false;
    preview
      .mutateAsync({ kind, payload: meta.samplePayload })
      .then((r) => {
        if (!cancel) setCurrentText({ subject: r.subject, body: r.body });
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, [kind, open]);

  if (!kind || !meta) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} title="Mensaje">
        <div className="text-[12px] text-[var(--color-fg-subtle)] italic">
          Sin mensaje seleccionado.
        </div>
      </Drawer>
    );
  }

  function insertVar(varKey: string) {
    const target =
      lastFocused.current === 'subject' ? subjectRef.current : bodyRef.current;
    if (!target) return;
    const token = `{{${varKey}}}`;
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? start;
    target.value = target.value.slice(0, start) + token + target.value.slice(end);
    const pos = start + token.length;
    target.focus();
    target.setSelectionRange(pos, pos);
  }

  const handleSave = async () => {
    const subject = subjectRef.current?.value ?? '';
    const body = bodyRef.current?.value ?? '';
    if (subject.trim() === '' || body.trim() === '') {
      toast.error('Escribí el asunto y el cuerpo del mensaje.');
      return;
    }
    try {
      await upsert.mutateAsync({
        kind,
        subjectTemplate: subject,
        bodyTemplate: body,
        enabled: true,
      });
      toast.success('Mensaje personalizado guardado', { description: meta.label });
      onOpenChange(false);
    } catch (err) {
      toast.error('No se pudo guardar', { description: mapError(err) });
    }
  };

  const handleReset = async () => {
    try {
      await remove.mutateAsync(kind);
      toast.success('Volvió al texto por defecto', { description: meta.label });
      onOpenChange(false);
    } catch (err) {
      toast.error('No se pudo restablecer', { description: mapError(err) });
    }
  };

  const handlePreview = async () => {
    setPreviewError(null);
    setDraftPreview(null);
    const subject = subjectRef.current?.value ?? '';
    const body = bodyRef.current?.value ?? '';
    if (subject.trim() === '' && body.trim() === '') {
      setPreviewError('Escribí algo para previsualizar.');
      return;
    }
    try {
      const res = await preview.mutateAsync({
        kind,
        payload: meta.samplePayload,
        subjectTemplate: subject.trim() || undefined,
        bodyTemplate: body.trim() || undefined,
      });
      setDraftPreview({ subject: res.subject, body: res.body });
    } catch (err) {
      setPreviewError(mapError(err));
    }
  };

  const isPending = upsert.isPending || remove.isPending;

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={meta.label}
      subtitle={hasOverride ? 'Personalizado' : 'Texto por defecto'}
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
              onClick={() => void handleReset()}
              disabled={isPending}
            >
              <RotateCcw className="size-3.5" />
              Volver al texto por defecto
            </Button>
          )}
          <Button
            variant="primary"
            size="md"
            type="button"
            onClick={() => void handleSave()}
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
                Guardar
              </>
            )}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <p className="text-[13px] text-[var(--color-fg-muted)]">
          {meta.whenSent}{' '}
          <span className="text-[var(--color-fg-subtle)]">
            Le llega {meta.audience === 'jugador' ? 'al jugador' : 'a vos (admin)'}.
          </span>
        </p>

        {/* Texto actual (cómo lo ven hoy) */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] font-medium">
            Así lo ven hoy {meta.audience === 'jugador' ? 'los jugadores' : 'los admins'}
          </span>
          {currentText ? (
            <div className="bg-[var(--color-bg-subtle)] border border-[var(--color-border)] p-3 flex flex-col gap-1">
              <span className="text-[13px] font-semibold text-[var(--color-fg)]">
                {currentText.subject}
              </span>
              <span className="text-[12px] text-[var(--color-fg-muted)] whitespace-pre-wrap">
                {currentText.body}
              </span>
            </div>
          ) : (
            <div className="text-[12px] text-[var(--color-fg-subtle)] italic">
              Cargando…
            </div>
          )}
        </div>

        {/* Editor */}
        <div className="flex flex-col gap-4 pt-2 border-t border-[var(--color-border)]">
          <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] font-medium">
            {hasOverride ? 'Editá tu texto' : 'Personalizá el texto'}
          </span>

          <FormField id="tpl-subject" label="Asunto" required>
            <Input
              id="tpl-subject"
              key={`subj-${kind}`}
              type="text"
              ref={subjectRef}
              onFocus={() => (lastFocused.current = 'subject')}
              defaultValue={currentOverride?.subjectTemplate ?? ''}
              placeholder="Ej: Tu depósito fue aprobado"
            />
          </FormField>

          <FormField id="tpl-body" label="Cuerpo del mensaje" required>
            <textarea
              id="tpl-body"
              key={`body-${kind}`}
              rows={6}
              ref={bodyRef}
              onFocus={() => (lastFocused.current = 'body')}
              defaultValue={currentOverride?.bodyTemplate ?? ''}
              placeholder="Ej: ¡Hola! Tu depósito de {{amountChips}} fichas ya está acreditado."
              className={textareaClass(false)}
            />
          </FormField>

          {/* Chips de variables */}
          {meta.variables.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] text-[var(--color-fg-subtle)]">
                Insertá datos (se reemplazan solos por el valor real):
              </span>
              <div className="flex flex-wrap gap-1.5">
                {meta.variables.map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => insertVar(v.key)}
                    className="px-2 h-7 text-[11px] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] text-[var(--color-fg-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-fg)] transition-colors"
                    title={`Insertar ${v.label}`}
                  >
                    + {v.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={() => void handlePreview()}
              disabled={preview.isPending}
            >
              {preview.isPending ? (
                <>
                  <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                  Generando…
                </>
              ) : (
                <>
                  <Eye className="size-3.5" />
                  Vista previa
                </>
              )}
            </Button>
            {previewError && (
              <p className="text-[11px] text-[#ef4444] mt-1.5">{previewError}</p>
            )}
          </div>

          {draftPreview && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-accent-text)] font-medium">
                Así lo verían con tu texto
              </span>
              <div className="bg-[var(--color-bg)] border border-[var(--color-accent-border)] p-3 flex flex-col gap-1">
                <span className="text-[13px] font-semibold text-[var(--color-fg)]">
                  {draftPreview.subject}
                </span>
                <span className="text-[12px] text-[var(--color-fg-muted)] whitespace-pre-wrap">
                  {draftPreview.body}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}

function textareaClass(invalid: boolean): string {
  return cn(
    'flex w-full px-3 py-2 resize-y',
    'bg-[var(--color-bg-subtle)] text-[var(--color-fg)]',
    'border border-[var(--color-border)]',
    'placeholder:text-[var(--color-fg-subtle)]',
    'text-[13px] leading-relaxed',
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
  if (err.status === 404) return 'Mensaje no encontrado.';
  return err.message || 'Error inesperado.';
}
