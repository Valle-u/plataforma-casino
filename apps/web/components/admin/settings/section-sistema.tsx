/**
 * SectionSistema — la operación del sitio del jugador:
 *   - Modo mantenimiento / registro de jugadores (toggles).
 *   - Aviso global + mínimos de depósito/retiro.
 *   - Guardado del registro de cambios (retención).
 *   - Limpiar el registro manualmente.
 *   - Opciones avanzadas (keys sin descripción, JSON crudo) detrás del toggle "Avanzado".
 *
 * Guardado por sección: PATCH solo de las keys que cambiaron.
 */

'use client';

import { History, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { EditSettingDrawer } from '@/components/admin/edit-setting-drawer';
import { Button } from '@/components/ui/button';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { SwitchRow } from '@/components/ui/switch';
import { isApiError } from '@/lib/api-client';
import {
  KNOWN_SETTINGS_BY_KEY,
  usePurgeSettingsHistory,
  useSetSetting,
  type TenantSettingRow,
} from '@/lib/hooks/use-tenant-settings';
import { CustomSettingRow, SaveButton, SectionCard } from './settings-common';

interface SystemDraft {
  maintenanceEnabled: boolean;
  registrationEnabled: boolean;
  announcementText: string;
  depositMin: string;
  withdrawalMin: string;
  retentionDays: string;
}

export function SectionSistema({
  settingsByKey,
}: {
  settingsByKey: Map<string, TenantSettingRow>;
}) {
  const purge = usePurgeSettingsHistory();
  const setSetting = useSetSetting();
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const get = (key: string, fallback: unknown): unknown =>
    settingsByKey.get(key)?.value ?? fallback;

  const [draft, setDraft] = useState<SystemDraft>(() => ({
    maintenanceEnabled: get('site.maintenance_enabled', false) === true,
    registrationEnabled: get('site.registration_enabled', true) !== false,
    announcementText:
      typeof get('site.announcement_text', '') === 'string'
        ? (get('site.announcement_text', '') as string)
        : '',
    depositMin: numToInput(get('deposits.min_amount', 0)),
    withdrawalMin: numToInput(get('withdrawals.min_amount', 0)),
    retentionDays: numToInput(get('tenant_settings.history_retention_days', 365)),
  }));

  // Sync draft cuando llegan los settings (carga inicial / refetch).
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (!hydrated && settingsByKey.size > 0) {
      setDraft({
        maintenanceEnabled: get('site.maintenance_enabled', false) === true,
        registrationEnabled: get('site.registration_enabled', true) !== false,
        announcementText:
          typeof get('site.announcement_text', '') === 'string'
            ? (get('site.announcement_text', '') as string)
            : '',
        depositMin: numToInput(get('deposits.min_amount', 0)),
        withdrawalMin: numToInput(get('withdrawals.min_amount', 0)),
        retentionDays: numToInput(get('tenant_settings.history_retention_days', 365)),
      });
      setHydrated(true);
    }
  }, [settingsByKey]);

  const customSettings = Array.from(settingsByKey.values()).filter(
    (s) => !KNOWN_SETTINGS_BY_KEY.has(s.key),
  );

  const handleSave = async () => {
    const patches: Array<{ key: string; value: unknown }> = [];
    const minDeposit = parseNum(draft.depositMin);
    const minWithdrawal = parseNum(draft.withdrawalMin);
    const retention = parseNum(draft.retentionDays);
    if (minDeposit == null || minWithdrawal == null || retention == null) {
      toast.error('Revisá los números', { description: 'Depósito/retiro/retención deben ser números válidos.' });
      return;
    }

    if (draft.maintenanceEnabled !== (get('site.maintenance_enabled', false) === true)) {
      patches.push({ key: 'site.maintenance_enabled', value: draft.maintenanceEnabled });
    }
    if (draft.registrationEnabled !== (get('site.registration_enabled', true) !== false)) {
      patches.push({ key: 'site.registration_enabled', value: draft.registrationEnabled });
    }
    const currentAnnouncement = get('site.announcement_text', '') as string;
    if (draft.announcementText !== currentAnnouncement) {
      patches.push({ key: 'site.announcement_text', value: draft.announcementText });
    }
    if (minDeposit !== (get('deposits.min_amount', 0) as number)) {
      patches.push({ key: 'deposits.min_amount', value: minDeposit });
    }
    if (minWithdrawal !== (get('withdrawals.min_amount', 0) as number)) {
      patches.push({ key: 'withdrawals.min_amount', value: minWithdrawal });
    }
    if (retention !== (get('tenant_settings.history_retention_days', 365) as number)) {
      patches.push({ key: 'tenant_settings.history_retention_days', value: retention });
    }

    if (patches.length === 0) {
      toast.info('Sin cambios', { description: 'Nada que guardar en esta sección.' });
      return;
    }

    setIsSaving(true);
    try {
      await Promise.all(patches.map((p) => setSetting.mutateAsync(p)));
      toast.success('Sistema guardado', { description: `${patches.length} key(s) actualizadas.` });
    } catch (err) {
      toast.error('No se pudo guardar', { description: mapError(err) });
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddCustomKey = async () => {
    const key = newKey.trim();
    if (!key) {
      toast.error('Falta la key');
      return;
    }
    let parsed: unknown;
    try {
      parsed = newValue.trim() ? JSON.parse(newValue) : null;
    } catch {
      toast.error('JSON inválido', { description: 'El valor debe ser JSON válido.' });
      return;
    }
    try {
      await setSetting.mutateAsync({ key, value: parsed });
      toast.success('Custom key creada', { description: key });
      setNewKey('');
      setNewValue('');
    } catch (err) {
      toast.error('No se pudo crear', { description: mapError(err) });
    }
  };

  const handlePurge = async () => {
    try {
      const res = await purge.mutateAsync();
      toast.success(
        res.deleted > 0
          ? `${res.deleted} cambios viejos limpiados`
          : 'No había cambios viejos para limpiar',
        { description: `Se borró lo más viejo que ${res.retentionDaysApplied} días.` },
      );
      setConfirmPurge(false);
    } catch (err) {
      toast.error('No se pudo purgar', { description: mapError(err) });
    }
  };

  return (
    <SectionCard
      title="Sistema"
      description="La operación del día a día: disponibilidad del casino, registros, mínimos de dinero y avisos para el jugador."
      footer={
        <SaveButton
          onClick={handleSave}
          isSaving={isSaving || setSetting.isPending}
          label="Guardar sistema"
        />
      }
    >
      {/* Toggles operativos */}
      <div className="flex flex-col gap-4 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] p-4">
        <SwitchRow
          label="Modo mantenimiento"
          hint="Apaga el casino para los jugadores: ven una pantalla de “estamos en mantenimiento” y no pueden jugar. Vos seguís entrando al panel sin problemas."
          checked={draft.maintenanceEnabled}
          onChange={(v) => setDraft((d) => ({ ...d, maintenanceEnabled: v }))}
        />
        <SwitchRow
          label="Registro de jugadores"
          hint="Permite cuentas nuevas. Apagado: los visitantes ven el aviso de “registros cerrados” y el sistema rechaza el registro."
          checked={draft.registrationEnabled}
          onChange={(v) => setDraft((d) => ({ ...d, registrationEnabled: v }))}
        />
      </div>

      {/* Banner + límites */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <label className="text-[11px] font-medium text-[var(--color-fg-muted)]">
            Aviso para todos los jugadores
          </label>
          <input
            value={draft.announcementText}
            onChange={(e) => setDraft((d) => ({ ...d, announcementText: e.target.value }))}
            placeholder="Ej: Mantenimiento el domingo de 00:00 a 06:00 hs."
            maxLength={500}
            className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm"
          />
          <p className="text-[10px] text-[var(--color-fg-subtle)] mt-1">
            Texto corto arriba de la página del jugador. Ej: “Mantenimiento el domingo de 00:00 a 06:00”. Vacío = no se muestra nada.
          </p>
        </div>
        <div>
          <label className="text-[11px] font-medium text-[var(--color-fg-muted)]">
            Depósito mínimo ($)
          </label>
          <input
            type="number"
            min={0}
            step="any"
            value={draft.depositMin}
            onChange={(e) => setDraft((d) => ({ ...d, depositMin: e.target.value }))}
            className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm font-mono"
            placeholder="0"
          />
          <p className="text-[10px] text-[var(--color-fg-subtle)] mt-1">
            Ej: 1000 = nadie puede depositar menos de $1.000. 0 = sin mínimo.
          </p>
        </div>
        <div>
          <label className="text-[11px] font-medium text-[var(--color-fg-muted)]">
            Retiro mínimo ($)
          </label>
          <input
            type="number"
            min={0}
            step="any"
            value={draft.withdrawalMin}
            onChange={(e) => setDraft((d) => ({ ...d, withdrawalMin: e.target.value }))}
            className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm font-mono"
            placeholder="0"
          />
          <p className="text-[10px] text-[var(--color-fg-subtle)] mt-1">
            Ej: 500 = nadie puede retirar menos de $500. 0 = sin mínimo.
          </p>
        </div>
        <div>
          <label className="text-[11px] font-medium text-[var(--color-fg-muted)]">
            Guardar registro de cambios (días)
          </label>
          <input
            type="number"
            min={7}
            max={3650}
            step={1}
            value={draft.retentionDays}
            onChange={(e) => setDraft((d) => ({ ...d, retentionDays: e.target.value }))}
            className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm font-mono"
            placeholder="365"
          />
          <p className="text-[10px] text-[var(--color-fg-subtle)] mt-1">
            Ej: 365 = se guarda un año de cambios en esta pantalla.
          </p>
        </div>
      </div>

      {/* Purge */}
      <div className="flex items-center justify-between gap-4 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] p-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px] font-medium text-[var(--color-fg)]">
            Limpiar el registro de cambios
          </span>
          <p className="text-[11px] text-[var(--color-fg-muted)]">
            Borra lo más viejo que el tiempo configurado arriba. Normalmente no hace falta: se limpia solo, todos los días.
          </p>
        </div>
        <Button variant="ghost" size="md" onClick={() => setConfirmPurge(true)} disabled={purge.isPending}>
          <History className="size-3.5" />
          Limpiar ahora
        </Button>
      </div>

      {/* Avanzado: custom keys */}
      <div className="rounded-[var(--radius)] border border-[var(--color-border)]">
        <button
          type="button"
          onClick={() => setAdvanced(!advanced)}
          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[var(--color-bg-subtle)] transition-colors"
        >
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] font-medium text-[var(--color-fg)]">
              Avanzado
            </span>
            <span className="text-[11px] text-[var(--color-fg-muted)]">
              Opciones especiales en formato técnico. Solo si sabés qué estás haciendo.
            </span>
          </div>
          <span className="text-[11px] font-mono text-[var(--color-fg-subtle)]">
            {advanced ? 'ocultar ▲' : 'mostrar ▼'}
          </span>
        </button>

        {advanced && (
          <div className="px-4 pb-4 flex flex-col gap-4 border-t border-[var(--color-border)]">
            {customSettings.length === 0 ? (
              <p className="text-[11px] text-[var(--color-fg-subtle)] italic pt-3">
                Sin custom keys configuradas.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--color-border)] -mx-4">
                {customSettings.map((s) => (
                  <CustomSettingRow
                    key={s.key}
                    row={s}
                    onEdit={() => setEditKey(s.key)}
                  />
                ))}
              </ul>
            )}

            {/* Add custom key */}
            <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] p-3 flex flex-col gap-2">
              <span className="text-[11px] font-semibold text-[var(--color-fg)] flex items-center gap-1.5">
                <Plus className="size-3" />
                Nueva custom key
              </span>
              <input
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="ej: marketing.home_banner_url"
                className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm font-mono"
              />
              <textarea
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder='{"url": "https://..."}'
                rows={2}
                className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[12px] font-mono resize-y"
              />
              <div className="flex justify-end">
                <Button variant="secondary" size="sm" onClick={handleAddCustomKey} disabled={setSetting.isPending}>
                  <Plus className="size-3.5" />
                  Crear
                </Button>
              </div>
            </div>

            <p className="text-[10px] text-[var(--color-fg-subtle)]">
              {customSettings.length} custom key(s) ·{' '}
              {KNOWN_SETTINGS_BY_KEY.size} keys conocidas
            </p>
          </div>
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
        title="Limpiar el registro"
        description="Borra los cambios de configuración más viejos que los días configurados arriba."
        warning="No se puede deshacer. Igual no hace falta en el día a día: se limpia solo."
        confirmLabel="Limpiar"
        confirmIcon={<Trash2 className="size-3.5" />}
        confirmVariant="outline-accent"
        onConfirm={handlePurge}
        isPending={purge.isPending}
      />
    </SectionCard>
  );
}

function numToInput(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '0';
}

function parseNum(s: string): number | null {
  const n = Number(s.trim());
  return Number.isFinite(n) ? n : null;
}

function mapError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.status === 403) return 'No tenés permiso.';
  return err.message || 'Error inesperado.';
}
