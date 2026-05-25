/**
 * EditSettingDrawer — editor especializado por tipo de setting.
 *
 * Render según `valueType` del KNOWN_SETTINGS catalog (espeja registry
 * del backend):
 *   - 'boolean': toggle on/off.
 *   - 'number' / 'integer': input numérico con min/max (validación zod).
 *   - 'json': textarea con validación JSON parse.
 *
 * Custom keys (no en catalog): siempre JSON textarea.
 *
 * Acciones:
 *   - Guardar (PATCH).
 *   - Reset al default (DELETE = unset → backend hace fall-through al default).
 *   - History inline (últimos 50 cambios).
 */

'use client';

import { Calendar, Check, RotateCcw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiError } from '@/lib/api-client';
import {
  KNOWN_SETTINGS_BY_KEY,
  useSetSetting,
  useTenantSettingHistory,
  useUnsetSetting,
  type TenantSettingRow,
} from '@/lib/hooks/use-tenant-settings';
import { cn } from '@/lib/cn';

interface EditSettingDrawerProps {
  settingKey: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: TenantSettingRow | undefined;
}

export function EditSettingDrawer({
  settingKey,
  open,
  onOpenChange,
  current,
}: EditSettingDrawerProps) {
  const meta = settingKey ? KNOWN_SETTINGS_BY_KEY.get(settingKey) : undefined;
  const valueType = meta?.valueType ?? 'json';

  // Estado local del valor que se está editando.
  // Para boolean: boolean. Para number/integer: string (input nativo). Para json: string.
  const initial = current?.value ?? meta?.defaultValue;
  const [draft, setDraft] = useState<string | boolean>(() =>
    serializeForInput(initial, valueType),
  );
  const [error, setError] = useState<string | null>(null);

  const setMutation = useSetSetting();
  const unsetMutation = useUnsetSetting();
  const history = useTenantSettingHistory(settingKey);

  // Reset draft cuando cambia la key abierta.
  useEffect(() => {
    if (settingKey) {
      setDraft(serializeForInput(initial, valueType));
      setError(null);
    }
  }, [settingKey, valueType, initial]);

  if (!settingKey) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} title="Setting">
        <div className="text-[12px] text-[var(--color-fg-subtle)] italic">
          Sin setting seleccionado.
        </div>
      </Drawer>
    );
  }

  const handleSave = async () => {
    setError(null);
    const parsed = parseDraft(draft, valueType, meta);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    try {
      await setMutation.mutateAsync({ key: settingKey, value: parsed.value });
      toast.success('Setting guardado', { description: settingKey });
      onOpenChange(false);
    } catch (err) {
      toast.error('No se pudo guardar', { description: mapError(err) });
    }
  };

  const handleReset = async () => {
    try {
      await unsetMutation.mutateAsync(settingKey);
      toast.success('Setting reseteado al default', { description: settingKey });
      onOpenChange(false);
    } catch (err) {
      toast.error('No se pudo resetear', { description: mapError(err) });
    }
  };

  const isPending = setMutation.isPending || unsetMutation.isPending;
  const hasOverride = !!current;

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={meta?.label ?? settingKey}
      subtitle={settingKey}
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
              title="Borrar override → vuelve al default"
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
            {setMutation.isPending ? (
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
        {meta?.description && (
          <p className="text-[12px] text-[var(--color-fg-muted)] leading-relaxed">
            {meta.description}
          </p>
        )}

        {/* Status: default vs custom */}
        <div className="flex items-center gap-2">
          {hasOverride ? (
            <Badge variant="success">custom</Badge>
          ) : (
            <Badge variant="neutral">default</Badge>
          )}
          {meta?.defaultValue !== undefined && (
            <span className="text-[10px] font-mono text-[var(--color-fg-subtle)]">
              default: {JSON.stringify(meta.defaultValue)}
            </span>
          )}
        </div>

        {/* Editor por tipo */}
        <FormField id="setting-value" label="Valor" error={error ?? undefined}>
          {valueType === 'boolean' ? (
            <BooleanToggle
              value={draft === true}
              onChange={(v) => setDraft(v)}
            />
          ) : valueType === 'number' || valueType === 'integer' ? (
            <Input
              id="setting-value"
              type="number"
              value={typeof draft === 'string' ? draft : ''}
              onChange={(e) => setDraft(e.target.value)}
              min={meta?.min}
              max={meta?.max}
              step={valueType === 'integer' ? 1 : 'any'}
              className="font-mono"
              invalid={!!error}
            />
          ) : valueType === 'color' ? (
            <ColorPicker
              value={typeof draft === 'string' ? draft : ''}
              onChange={(v) => setDraft(v)}
              invalid={!!error}
            />
          ) : valueType === 'url' ? (
            <div className="flex flex-col gap-2">
              <Input
                id="setting-value"
                type="url"
                value={typeof draft === 'string' ? draft : ''}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="https://cdn.example.com/logo.png"
                className="font-mono text-[12px]"
                invalid={!!error}
              />
              {typeof draft === 'string' && draft.startsWith('https://') && (
                <UrlPreview url={draft} />
              )}
            </div>
          ) : (
            <textarea
              id="setting-value"
              rows={6}
              value={typeof draft === 'string' ? draft : ''}
              onChange={(e) => setDraft(e.target.value)}
              aria-invalid={!!error}
              className={cn(
                'flex w-full px-3 py-2 resize-y',
                'bg-[var(--color-bg-subtle)] text-[var(--color-fg)]',
                'border border-[var(--color-border)]',
                'text-[12px] leading-relaxed font-mono',
                'transition-[border-color,box-shadow] duration-150',
                'hover:border-[var(--color-border-strong)]',
                'focus:outline-none focus:border-[var(--color-accent)]',
                'focus:shadow-[0_0_0_3px_var(--color-accent-glow)]',
                error && 'border-[var(--color-accent)] shadow-[0_0_0_3px_var(--color-accent-glow)]',
              )}
            />
          )}
        </FormField>

        {/* Constraints hint */}
        {(meta?.min !== undefined || meta?.max !== undefined) && (
          <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-mono">
            {meta.min !== undefined && `min: ${meta.min}`}
            {meta.min !== undefined && meta.max !== undefined && ' · '}
            {meta.max !== undefined && `max: ${meta.max}`}
          </div>
        )}

        {/* Historial */}
        <div className="flex flex-col gap-2 pt-2 border-t border-[var(--color-border)]">
          <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] font-medium">
            Historial · últimos 50 cambios
          </span>
          {history.isLoading ? (
            <Skeleton className="h-16 w-full bg-[var(--color-bg-subtle)]" />
          ) : !history.data || history.data.data.length === 0 ? (
            <span className="text-[11px] text-[var(--color-fg-subtle)] italic">
              Sin cambios registrados.
            </span>
          ) : (
            <ul className="flex flex-col gap-1 max-h-[200px] overflow-y-auto">
              {history.data.data.map((h) => (
                <li
                  key={h.id}
                  className="flex items-start gap-2 px-2 py-1.5 text-[11px] bg-[var(--color-bg)] border border-[var(--color-border)]"
                >
                  <Calendar className="size-3 text-[var(--color-fg-subtle)] mt-0.5 shrink-0" />
                  <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                    <span className="font-mono text-[var(--color-fg-muted)]">
                      {formatFull(h.changedAt)}
                    </span>
                    <span className="font-mono text-[var(--color-fg)] truncate">
                      {JSON.stringify(h.value)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Drawer>
  );
}

// ──────────────────────────────────────────────────────────────────────
// BooleanToggle (pill style)
// ──────────────────────────────────────────────────────────────────────

function BooleanToggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-px bg-[var(--color-border)] border border-[var(--color-border)] self-start">
      {[true, false].map((opt) => (
        <button
          key={String(opt)}
          type="button"
          onClick={() => onChange(opt)}
          className={cn(
            'px-4 h-8 text-[11px] uppercase tracking-[0.08em] font-medium font-mono',
            'transition-colors duration-150',
            value === opt
              ? opt
                ? 'bg-[var(--color-success-bg)] text-[var(--color-success)] border-b-2 border-b-[var(--color-success)]'
                : 'bg-[var(--color-bg)] text-[var(--color-fg)] border-b-2 border-b-[var(--color-fg-subtle)]'
              : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)]',
          )}
        >
          {String(opt)}
        </button>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// ColorPicker — input nativo + hex text input sincronizados
// ──────────────────────────────────────────────────────────────────────

function ColorPicker({
  value,
  onChange,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  invalid: boolean;
}) {
  // El input nativo de color SIEMPRE devuelve #RRGGBB lowercase. Si
  // `value` no es hex válido todavía (e.g. usuario tipeando), forzamos
  // un fallback para que el picker no rompa.
  const safeValue = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000';
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={safeValue}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'size-10 cursor-pointer border bg-transparent',
          'p-0', // resetea el padding interno del nativo
          invalid
            ? 'border-[var(--color-accent)]'
            : 'border-[var(--color-border)]',
        )}
        aria-label="Picker de color"
      />
      <Input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="#dc2626"
        className="font-mono uppercase"
        maxLength={7}
        invalid={invalid}
      />
      <div
        className="size-10 border border-[var(--color-border-strong)] shrink-0"
        style={{ backgroundColor: safeValue }}
        aria-hidden
        title="Preview"
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// UrlPreview — thumbnail si la URL apunta a una imagen
// ──────────────────────────────────────────────────────────────────────

function UrlPreview({ url }: { url: string }) {
  // Heurística: si termina en extensión de imagen, mostramos <img>.
  // Sino, mostramos el link plano. Robust enough — el admin ve si su
  // logo carga o no antes de guardar.
  const looksLikeImage = /\.(png|jpe?g|gif|svg|webp|avif)(\?.*)?$/i.test(url);
  return (
    <div className="flex items-center gap-3 p-2 border border-[var(--color-border)] bg-[var(--color-bg-subtle)]">
      {looksLikeImage ? (
         
        <img
          src={url}
          alt="Preview"
          className="h-10 w-auto max-w-[120px] object-contain bg-[var(--color-bg)]"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        <span className="text-[11px] text-[var(--color-fg-subtle)] font-mono">
          (URL sin extensión de imagen reconocida)
        </span>
      )}
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="text-[11px] text-[var(--color-accent-text)] hover:underline truncate flex-1"
      >
        Abrir ↗
      </a>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Serializers + parsers
// ──────────────────────────────────────────────────────────────────────

type ValueType = 'boolean' | 'number' | 'integer' | 'json' | 'color' | 'url';

function serializeForInput(
  value: unknown,
  valueType: ValueType,
): string | boolean {
  if (valueType === 'boolean') return value === true;
  if (valueType === 'number' || valueType === 'integer') {
    if (value === undefined || value === null) return '';
    // Solo number o string parseable. Si el setting está mal tipado
    // (objeto), devolvemos '' para que el editor empiece vacío en vez
    // de mostrar "[object Object]".
    if (typeof value === 'number' || typeof value === 'string')
      return String(value);
    return '';
  }
  if (valueType === 'color' || valueType === 'url') {
    if (typeof value === 'string') return value;
    return '';
  }
  // JSON
  if (value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}

interface ParseSuccess {
  ok: true;
  value: unknown;
}
interface ParseError {
  ok: false;
  error: string;
}

function parseDraft(
  draft: string | boolean,
  valueType: ValueType,
  meta: { min?: number; max?: number } | undefined,
): ParseSuccess | ParseError {
  if (valueType === 'boolean') {
    return { ok: true, value: draft === true };
  }
  if (valueType === 'number' || valueType === 'integer') {
    const s = typeof draft === 'string' ? draft.trim() : '';
    if (s === '') return { ok: false, error: 'Requerido.' };
    const n = Number(s);
    if (!Number.isFinite(n)) return { ok: false, error: 'Número inválido.' };
    if (valueType === 'integer' && !Number.isInteger(n)) {
      return { ok: false, error: 'Debe ser entero.' };
    }
    if (meta?.min !== undefined && n < meta.min) {
      return { ok: false, error: `Mínimo ${meta.min}.` };
    }
    if (meta?.max !== undefined && n > meta.max) {
      return { ok: false, error: `Máximo ${meta.max}.` };
    }
    return { ok: true, value: n };
  }
  if (valueType === 'color') {
    const s = typeof draft === 'string' ? draft.trim() : '';
    if (s === '') return { ok: false, error: 'Requerido.' };
    if (!/^#[0-9a-fA-F]{6}$/.test(s)) {
      return { ok: false, error: 'Debe ser hex #RRGGBB.' };
    }
    return { ok: true, value: s.toLowerCase() };
  }
  if (valueType === 'url') {
    const s = typeof draft === 'string' ? draft.trim() : '';
    if (s === '') return { ok: false, error: 'Requerido.' };
    if (!s.startsWith('https://')) {
      return { ok: false, error: 'Debe ser URL HTTPS.' };
    }
    try {
      new URL(s);
    } catch {
      return { ok: false, error: 'URL inválida.' };
    }
    return { ok: true, value: s };
  }
  // JSON
  const s = typeof draft === 'string' ? draft.trim() : '';
  if (s === '') return { ok: false, error: 'Requerido.' };
  try {
    const parsed = JSON.parse(s);
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, error: 'JSON inválido.' };
  }
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
  if (err.status === 400) {
    const details = err.details as {
      issues?: Array<{ path: unknown; message: string }>;
    } | null;
    if (details?.issues && details.issues.length > 0) {
      return details.issues.map((i) => i.message).join(' · ');
    }
    return err.message || 'Datos inválidos.';
  }
  if (err.status === 403) return 'No tenés permiso.';
  return err.message || 'Error inesperado.';
}
