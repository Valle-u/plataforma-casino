/**
 * /settings — config runtime del tenant.
 *
 * Composición:
 *   - Header: título + counter + "Purgar history".
 *   - Section "Conocidos" agrupados por categoría: cada uno muestra el
 *     valor actual o el default + botón "Editar". Si tiene override
 *     custom (en DB), aparece badge "custom"; sino "default".
 *   - Section "Otros (custom keys)": settings que el admin creó con keys
 *     no registradas en el catálogo conocido — JSON crudo.
 *   - Drawer de edit: form especializado por valueType (boolean toggle,
 *     number/integer input numérico, JSON textarea) + botones Save / Reset
 *     (unset = volver al default) + historial inline.
 */

'use client';

import { History, RefreshCw, Settings as SettingsIcon, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { EditSettingDrawer } from '@/components/admin/edit-setting-drawer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiError } from '@/lib/api-client';
import {
  KNOWN_SETTINGS,
  KNOWN_SETTINGS_BY_KEY,
  usePurgeSettingsHistory,
  useTenantSettings,
  type KnownSettingMeta,
  type SettingValueType,
  type TenantSettingRow,
} from '@/lib/hooks/use-tenant-settings';
import { cn } from '@/lib/cn';

export default function SettingsPage() {
  const settings = useTenantSettings();
  const purge = usePurgeSettingsHistory();
  const [editKey, setEditKey] = useState<string | null>(null);
  const [confirmPurge, setConfirmPurge] = useState(false);

  const settingsByKey = useMemo(() => {
    const map = new Map<string, TenantSettingRow>();
    for (const s of settings.data?.data ?? []) map.set(s.key, s);
    return map;
  }, [settings.data]);

  // Group known settings by category.
  const knownByCategory = useMemo(() => {
    const map = new Map<string, KnownSettingMeta[]>();
    for (const m of KNOWN_SETTINGS) {
      const arr = map.get(m.category) ?? [];
      arr.push(m);
      map.set(m.category, arr);
    }
    return map;
  }, []);

  // Custom keys = en DB pero no en KNOWN_SETTINGS_BY_KEY.
  const customSettings = useMemo(
    () =>
      (settings.data?.data ?? []).filter((s) => !KNOWN_SETTINGS_BY_KEY.has(s.key)),
    [settings.data],
  );

  const handlePurge = async () => {
    try {
      const res = await purge.mutateAsync();
      toast.success(
        res.deleted > 0
          ? `${res.deleted} entries de history purgadas`
          : 'Sin entries antiguas para purgar',
        { description: `Retención: ${res.retentionDaysApplied} días.` },
      );
      setConfirmPurge(false);
    } catch (err) {
      toast.error('No se pudo purgar', { description: mapError(err) });
    }
  };

  return (
    <>
      <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[1400px] mx-auto">
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-2">
          <div className="flex flex-col gap-2">
            <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
              <SettingsIcon className="size-3" />
              Sistema · Ajustes
            </span>
            <h1 className="font-display text-3xl lg:text-[2.5rem] leading-none tracking-tight">
              Configuración del tenant
            </h1>
            <p className="text-sm text-[var(--color-fg-muted)] mt-1">
              Settings runtime. Cambios quedan en audit + history.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="md"
              onClick={() => settings.refetch()}
              disabled={settings.isFetching}
            >
              <RefreshCw
                className={cn('size-3.5', settings.isFetching && 'animate-spin')}
              />
              Refrescar
            </Button>
            <Button
              variant="ghost"
              size="md"
              onClick={() => setConfirmPurge(true)}
              disabled={purge.isPending}
            >
              <History className="size-3.5" />
              Purgar history
            </Button>
          </div>
        </header>

        {settings.isLoading ? (
          <div className="flex flex-col gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton
                key={i}
                className="h-32 w-full bg-[var(--color-bg-subtle)]"
              />
            ))}
          </div>
        ) : settings.isError ? (
          <EmptyState
            hint="settings"
            label="No se pudieron cargar los settings."
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => settings.refetch()}
              >
                Reintentar
              </Button>
            }
          />
        ) : (
          <>
            {/* Conocidos agrupados por categoría */}
            {Array.from(knownByCategory.entries()).map(([category, items]) => (
              <section
                key={category}
                className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto"
              >
                <div className="px-4 py-2 border-b border-[var(--color-border)]">
                  <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-medium">
                    {category}
                  </span>
                </div>
                <ul className="divide-y divide-[var(--color-border)]">
                  {items.map((meta) => (
                    <KnownSettingRow
                      key={meta.key}
                      meta={meta}
                      current={settingsByKey.get(meta.key)}
                      onEdit={() => setEditKey(meta.key)}
                    />
                  ))}
                </ul>
              </section>
            ))}

            {/* Custom keys */}
            {customSettings.length > 0 && (
              <section className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto">
                <div className="px-4 py-2 border-b border-[var(--color-border)]">
                  <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-medium">
                    Custom (sin schema registrado)
                  </span>
                </div>
                <ul className="divide-y divide-[var(--color-border)]">
                  {customSettings.map((s) => (
                    <CustomSettingRow
                      key={s.key}
                      row={s}
                      onEdit={() => setEditKey(s.key)}
                    />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>

      <EditSettingDrawer
        settingKey={editKey}
        open={!!editKey}
        onOpenChange={(o) => !o && setEditKey(null)}
        current={editKey ? settingsByKey.get(editKey) : undefined}
      />

      <ConfirmModal
        open={confirmPurge}
        onOpenChange={setConfirmPurge}
        title="Purgar history"
        description="Borra entries del history con changed_at más viejas que el retention configurado."
        warning="Acción no reversible. Igual el cron diario lo hace automático — usar solo para reconciliación manual."
        confirmLabel="Purgar"
        confirmIcon={<Trash2 className="size-3.5" />}
        confirmVariant="outline-accent"
        onConfirm={handlePurge}
        isPending={purge.isPending}
      />
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Rows
// ──────────────────────────────────────────────────────────────────────

function KnownSettingRow({
  meta,
  current,
  onEdit,
}: {
  meta: KnownSettingMeta;
  current: TenantSettingRow | undefined;
  onEdit: () => void;
}) {
  const hasOverride = !!current;
  const value = current?.value ?? meta.defaultValue;
  return (
    <li>
      <button
        type="button"
        onClick={onEdit}
        className="w-full text-left px-4 py-3 hover:bg-[var(--color-bg-subtle)] transition-colors border-l-2 border-l-transparent hover:border-l-[var(--color-accent)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[13px] text-[var(--color-fg)]">
                {meta.label}
              </span>
              {hasOverride ? (
                <Badge variant="success">custom</Badge>
              ) : (
                <Badge variant="neutral">default</Badge>
              )}
            </div>
            <span className="text-[10px] font-mono text-[var(--color-fg-subtle)] truncate">
              {meta.key}
            </span>
            <p className="text-[11px] text-[var(--color-fg-muted)] mt-1">
              {meta.description}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <ValueChip value={value} valueType={meta.valueType} />
            {hasOverride && (
              <span className="text-[10px] text-[var(--color-fg-subtle)] font-mono">
                modificado {formatDate(current.updatedAt)}
              </span>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}

function CustomSettingRow({
  row,
  onEdit,
}: {
  row: TenantSettingRow;
  onEdit: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onEdit}
        className="w-full text-left px-4 py-3 hover:bg-[var(--color-bg-subtle)] transition-colors border-l-2 border-l-transparent hover:border-l-[var(--color-accent)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <span className="text-[12px] font-mono text-[var(--color-fg)] truncate">
              {row.key}
            </span>
            <span className="text-[10px] text-[var(--color-fg-subtle)] font-mono">
              modificado {formatDate(row.updatedAt)}
            </span>
          </div>
          <ValueChip value={row.value} valueType="json" />
        </div>
      </button>
    </li>
  );
}

function ValueChip({
  value,
  valueType,
}: {
  value: unknown;
  valueType: SettingValueType;
}) {
  if (valueType === 'boolean') {
    return (
      <Badge variant={value === true ? 'success' : 'neutral'} dot>
        {value === true ? 'true' : 'false'}
      </Badge>
    );
  }
  if (valueType === 'number' || valueType === 'integer') {
    // Si el setting está mal tipado (objeto en vez de número), mostramos
    // "—" en vez de "[object Object]". El editor permite arreglarlo.
    const safe =
      typeof value === 'number' || typeof value === 'string'
        ? String(value)
        : '—';
    return (
      <span className="text-[13px] font-mono tabular-nums text-[var(--color-fg)]">
        {value === undefined ? '—' : safe}
      </span>
    );
  }
  if (valueType === 'color' && typeof value === 'string') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="size-4 border border-[var(--color-border-strong)] shrink-0"
          style={{ backgroundColor: value }}
        />
        <span className="text-[12px] font-mono uppercase text-[var(--color-fg)]">
          {value}
        </span>
      </div>
    );
  }
  if (valueType === 'url' && typeof value === 'string') {
    return (
      <span className="text-[11px] font-mono text-[var(--color-fg-muted)] truncate max-w-[280px]">
        {value}
      </span>
    );
  }
  // JSON / fallback. Ojo: JSON.stringify(undefined | function | symbol)
  // devuelve undefined (no el string "undefined"), así que coerce explícito.
  let s: string;
  try {
    const j = JSON.stringify(value);
    s = j ?? String(value);
  } catch {
    s = String(value);
  }
  return (
    <span className="text-[11px] font-mono text-[var(--color-fg-muted)] truncate max-w-[280px]">
      {s.length > 60 ? s.slice(0, 60) + '…' : s}
    </span>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('es-AR', {
      day: '2-digit',
      month: 'short',
      year: '2-digit',
    });
  } catch {
    return iso;
  }
}

function mapError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.status === 403) return 'No tenés permiso.';
  return err.message || 'Error inesperado.';
}
