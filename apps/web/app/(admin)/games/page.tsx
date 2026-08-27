'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  Puzzle,
  RefreshCw,
  Plug,
  Stethoscope,
  Check,
  X,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { HelpNote } from '@/components/ui/help-note';
import { PageHeader } from '@/components/ui/page-header';
import { PageShell } from '@/components/ui/page-shell';
import { isApiError } from '@/lib/api-client';
import {
  useGameProviders,
  useUpdateProvider,
  useTestProvider,
  useDiagnoseProvider,
  useSyncProvider,
  useActivateForeverCallback,
  type ProviderView,
  type DiagnoseCheck,
} from '@/lib/hooks/use-game-providers';
import { useSetSetting } from '@/lib/hooks/use-tenant-settings';
import { GamesTab } from '@/components/admin/games-tab';
import { ProviderLogsTab } from '@/components/admin/provider-logs-tab';

const TABS = [
  { key: 'providers', label: 'Proveedores' },
  { key: 'games', label: 'Juegos' },
  { key: 'logs', label: 'Logs / Diagnóstico' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default function GameProvidersPage() {
  const [tab, setTab] = useState<TabKey>('providers');

  // El buscador global (⌘K) navega a /games?tab=games&q=… → arrancamos en la
  // pestaña indicada. Se lee de window (client-only) para no necesitar un
  // Suspense boundary de useSearchParams.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t === 'games' || t === 'logs' || t === 'providers') setTab(t);
  }, []);

  return (
    <PageShell className="max-w-[920px]">
      <PageHeader
        icon={Puzzle}
        title="Proveedores de juego"
        description="Las empresas que te dan los juegos. Configurá su conexión, controlá su estado y sincronizá el catálogo."
      />

      <HelpNote id="game-providers">
        Un <strong>proveedor de juego</strong> es la empresa externa que te
        provee los juegos (tragamonedas, ruleta, etc.). Acá conectás cada uno con
        sus <strong>credenciales</strong>, <strong>probás la conexión</strong>{' '}
        para ver si responde, <strong>sincronizás el catálogo</strong> (traés la
        lista de juegos actualizada), configurás el <strong>costo</strong> (el %
        que el proveedor te cobra, que se descuenta antes de repartir comisiones)
        y podés ponerlo en <strong>mantenimiento</strong> para apagar sus juegos.
        Las 3 pestañas: <strong>Proveedores</strong> (la configuración),{' '}
        <strong>Juegos</strong> (el catálogo que trajiste) y{' '}
        <strong>Logs / Diagnóstico</strong> (para revisar problemas de conexión).
      </HelpNote>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--color-border)] overflow-x-auto hide-scrollbar">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="relative shrink-0 whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors"
            style={{
              color:
                tab === t.key
                  ? 'var(--color-fg)'
                  : 'var(--color-fg-muted)',
            }}
          >
            {t.label}
            {tab === t.key && (
              <span
                className="absolute left-0 right-0 -bottom-px h-0.5"
                style={{ background: 'var(--color-accent)' }}
              />
            )}
          </button>
        ))}
      </div>

      {tab === 'providers' && <ProvidersTab />}
      {tab === 'games' && <GamesTab />}
      {tab === 'logs' && <ProviderLogsTab code="palace" />}
    </PageShell>
  );
}

function ProvidersTab() {
  const { data, isLoading } = useGameProviders();

  if (isLoading) {
    return (
      <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius)] p-6 h-[280px] animate-pulse" />
    );
  }
  if (!data || data.length === 0) {
    return (
      <p className="text-[13px] text-[var(--color-fg-muted)]">
        No hay proveedores configurados.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      {data.map((p) => (
        <ProviderCard key={p.code} provider={p} />
      ))}
    </div>
  );
}

function Badge({
  tone,
  children,
}: {
  tone: 'ok' | 'warn' | 'error' | 'neutral';
  children: React.ReactNode;
}) {
  const c = ((): { bg: string; fg: string; bd: string } => {
    switch (tone) {
      case 'ok':
        return {
          bg: 'var(--color-success-subtle, rgba(34,197,94,0.12))',
          fg: 'var(--color-success)',
          bd: 'var(--color-success)',
        };
      case 'warn':
        return { bg: 'rgba(234,179,8,0.12)', fg: 'var(--color-warning)', bd: 'var(--color-warning)' };
      case 'error':
        return { bg: 'rgba(239,68,68,0.12)', fg: 'var(--color-danger)', bd: 'var(--color-danger)' };
      default:
        return {
          bg: 'var(--color-bg-subtle)',
          fg: 'var(--color-fg-muted)',
          bd: 'var(--color-border)',
        };
    }
  })();
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ background: c.bg, color: c.fg, border: `1px solid ${c.bd}` }}
    >
      {children}
    </span>
  );
}

/**
 * Campos de credenciales por proveedor. Cada campo sabe a qué key de
 * `tenant_settings` escribe. Los `secret` no se pre-cargan (vacío = no cambiar);
 * los `prefill` toman el valor actual de `provider.config`.
 */
type CredField = {
  key: string;
  label: string;
  kind: 'url' | 'text' | 'number' | 'secret';
  placeholder?: string;
  prefill?: 'apiUrl' | 'defaultLang';
};

const CRED_SCHEMAS: Record<string, CredField[]> = {
  palace: [
    { key: 'palace.api_url', label: 'API URL', kind: 'url', placeholder: 'https://agent.goldslotpalase.com', prefill: 'apiUrl' },
    { key: 'palace.default_lang', label: 'Idioma default (int)', kind: 'number', placeholder: '4', prefill: 'defaultLang' },
    { key: 'palace.api_token', label: 'API Token', kind: 'secret' },
  ],
  forever: [
    { key: 'game_provider.forever.api_url', label: 'API URL', kind: 'url', placeholder: 'https://api.aicvgdbi.win/api/casinoapi', prefill: 'apiUrl' },
    { key: 'game_provider.forever.agent_code', label: 'Agent code', kind: 'text', placeholder: 'redgardel' },
    { key: 'game_provider.forever.currency', label: 'Moneda (código, ej. ARS)', kind: 'text', placeholder: 'ARS' },
    { key: 'game_provider.forever.api_token', label: 'API Token', kind: 'secret' },
    { key: 'game_provider.forever.request_sign_private_key', label: 'Clave privada de firma (Ed25519, base64)', kind: 'secret' },
    { key: 'game_provider.forever.callback_verify_public_key', label: 'Clave pública de callbacks (Ed25519, base64)', kind: 'secret' },
  ],
};

function initCredValues(fields: CredField[], config: ProviderView['config']): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    if (f.prefill === 'apiUrl') out[f.key] = config.apiUrl ?? '';
    else if (f.prefill === 'defaultLang') out[f.key] = config.defaultLang != null ? String(config.defaultLang) : '';
    else out[f.key] = '';
  }
  return out;
}

function ProviderCard({ provider }: { provider: ProviderView }) {
  const update = useUpdateProvider();
  const test = useTestProvider();
  const diagnose = useDiagnoseProvider();
  const sync = useSyncProvider();
  const activate = useActivateForeverCallback();
  const setSetting = useSetSetting();
  const qc = useQueryClient();

  const [diagOpen, setDiagOpen] = useState<DiagnoseCheck[] | null>(null);
  const [savingCreds, setSavingCreds] = useState(false);
  const [feePct, setFeePct] = useState(provider.commissionFeePct ?? '0');
  const [savingFee, setSavingFee] = useState(false);
  // Form de credenciales (controlado — es un form de página, no un modal Radix).
  // Dirigido por descriptor: cada proveedor tiene sus propios campos/keys.
  const credFields = CRED_SCHEMAS[provider.code] ?? [];
  const [credValues, setCredValues] = useState<Record<string, string>>(() =>
    initCredValues(credFields, provider.config),
  );
  const setCredValue = (key: string, value: string) =>
    setCredValues((prev) => ({ ...prev, [key]: value }));

  const online =
    provider.lastPingOk === null
      ? null
      : provider.lastPingOk === true;

  // Sync en segundo plano: al terminar cambia `lastSyncAt` → lo detectamos por polling.
  const [syncing, setSyncing] = useState(false);
  const syncStartAtRef = useRef<string | null>(null);

  const handleSync = async () => {
    try {
      const res = await sync.mutateAsync(provider.code);
      if (res.alreadyRunning) {
        toast.info('Ya hay una sincronización en curso.', {
          description: 'Esperá a que termine (se actualiza sola).',
        });
        setSyncing(true);
        return;
      }
      syncStartAtRef.current = provider.lastSyncAt ? String(provider.lastSyncAt) : null;
      setSyncing(true);
      toast.info('Sincronización iniciada', {
        description: 'El catálogo puede tardar 1-2 min. Se actualiza solo acá.',
      });
    } catch (err) {
      toast.error('Error al sincronizar', {
        description: isApiError(err) ? err.message : 'Error de conexión',
      });
    }
  };

  // Mientras sincroniza: refrescar la vista cada 8s + cortar a los 4 min.
  useEffect(() => {
    if (!syncing) return;
    const iv = setInterval(() => {
      void qc.invalidateQueries({ queryKey: ['game-providers'] });
    }, 8000);
    const to = setTimeout(() => setSyncing(false), 240_000);
    return () => {
      clearInterval(iv);
      clearTimeout(to);
    };
  }, [syncing, qc]);

  // Detectar el fin del sync: `lastSyncAt` cambió respecto al arranque.
  useEffect(() => {
    if (!syncing) return;
    const cur = provider.lastSyncAt ? String(provider.lastSyncAt) : null;
    if (cur && cur !== syncStartAtRef.current) {
      setSyncing(false);
      const r = (provider.lastSyncResult ?? {}) as {
        vendors?: number; fetched?: number; upserted?: number; deactivated?: number;
      };
      if (provider.lastSyncOk) {
        toast.success('Catálogo sincronizado', {
          description: `${r.vendors ?? 0} vendors · ${r.fetched ?? 0} juegos · ${r.deactivated ?? 0} dados de baja`,
        });
      } else {
        toast.error('La sincronización falló', {
          description: 'Mirá el diagnóstico o los logs del proveedor.',
        });
      }
    }
  }, [provider.lastSyncAt, provider.lastSyncOk, provider.lastSyncResult, syncing]);

  const handleActivate = async () => {
    try {
      const res = await activate.mutateAsync(provider.code);
      toast.success('Callbacks activados', {
        description: `Agent code "${res.agentCode}" registrado en el sistema. Ya podés jugar.`,
      });
    } catch (err) {
      toast.error('No se pudo activar', {
        description: isApiError(err) ? err.message : 'Error de conexión',
      });
    }
  };

  const handleTest = async () => {
    try {
      const res = await test.mutateAsync(provider.code);
      if (res.ok) {
        toast.success('Conexión OK', {
          description: `Respondió en ${res.latencyMs} ms.`,
        });
      } else {
        toast.error('Sin conexión', {
          description: res.error ?? 'No se pudo conectar al proveedor.',
        });
      }
    } catch (err) {
      toast.error('Error al probar', {
        description: isApiError(err) ? err.message : 'Error de conexión',
      });
    }
  };

  const handleDiagnose = async () => {
    try {
      const res = await diagnose.mutateAsync(provider.code);
      setDiagOpen(res);
    } catch (err) {
      toast.error('Error al diagnosticar', {
        description: isApiError(err) ? err.message : 'Error de conexión',
      });
    }
  };

  const handleSaveFee = async () => {
    const n = Number(feePct);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      toast.error('El fee debe ser un número entre 0 y 100.');
      return;
    }
    setSavingFee(true);
    try {
      await update.mutateAsync({
        code: provider.code,
        patch: { commissionFeePct: n },
      });
      toast.success('Costo del proveedor guardado', {
        description: `${n}% se descontará de la base de comisión.`,
      });
    } catch (err) {
      toast.error('Error al guardar el fee', {
        description: isApiError(err) ? err.message : 'Error de conexión',
      });
    } finally {
      setSavingFee(false);
    }
  };

  const handleToggleMaintenance = async () => {
    try {
      await update.mutateAsync({
        code: provider.code,
        patch: { maintenanceMode: !provider.maintenanceMode },
      });
      toast.success(
        provider.maintenanceMode
          ? 'Mantenimiento desactivado'
          : 'Mantenimiento activado',
      );
    } catch (err) {
      toast.error('Error', {
        description: isApiError(err) ? err.message : 'Error de conexión',
      });
    }
  };

  const handleSaveCreds = async () => {
    setSavingCreds(true);
    try {
      const ops: Promise<unknown>[] = [];
      for (const f of credFields) {
        const raw = (credValues[f.key] ?? '').trim();
        if (f.kind === 'number') {
          // Prefilleable: escribir solo si cambió y es un entero válido >= 0.
          if (!raw) continue;
          const n = Number(raw);
          if (Number.isInteger(n) && n >= 0 && String(n) !== initCredValues(credFields, provider.config)[f.key]) {
            ops.push(setSetting.mutateAsync({ key: f.key, value: n }));
          }
          continue;
        }
        if (f.prefill === 'apiUrl') {
          // Escribir solo si cambió respecto al valor actual.
          if (raw && raw !== (provider.config.apiUrl ?? '')) {
            ops.push(setSetting.mutateAsync({ key: f.key, value: raw }));
          }
          continue;
        }
        // text/secret sin prefill: vacío = no cambiar; con valor = escribir.
        if (raw) ops.push(setSetting.mutateAsync({ key: f.key, value: raw }));
      }
      if (ops.length === 0) {
        toast.info('No hay cambios para guardar.');
        setSavingCreds(false);
        return;
      }
      await Promise.all(ops);
      // Limpiar los campos secretos tras guardar (no dejarlos en pantalla).
      setCredValues((prev) => {
        const next = { ...prev };
        for (const f of credFields) if (f.kind === 'secret') next[f.key] = '';
        return next;
      });
      toast.success('Credenciales guardadas');
      // Refrescar la vista del proveedor (badge "Configurado", apiUrl).
      await qc.invalidateQueries({ queryKey: ['game-providers'] });
    } catch (err) {
      toast.error('Error al guardar credenciales', {
        description: isApiError(err) ? err.message : 'Error de conexión',
      });
    } finally {
      setSavingCreds(false);
    }
  };

  return (
    <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius)]">
      {/* Header */}
      <div className="p-5 border-b border-[var(--color-border)] flex items-start justify-between gap-4 flex-wrap">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2.5">
            <Plug className="size-4 text-[var(--color-fg-muted)]" />
            <h2 className="text-base font-semibold">{provider.displayName}</h2>
            <code className="text-[11px] font-mono text-[var(--color-fg-subtle)]">
              {provider.code}
            </code>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {provider.configured ? (
              <Badge tone="ok">
                <Check className="size-3" /> Configurado
              </Badge>
            ) : (
              <Badge tone="warn">
                <AlertTriangle className="size-3" /> Falta configurar
              </Badge>
            )}
            {online === null ? (
              <Badge tone="neutral">Sin probar</Badge>
            ) : online ? (
              <Badge tone="ok">
                Online{provider.lastPingLatencyMs != null ? ` · ${provider.lastPingLatencyMs}ms` : ''}
              </Badge>
            ) : (
              <Badge tone="error">
                <X className="size-3" /> Offline
              </Badge>
            )}
            {provider.maintenanceMode && (
              <Badge tone="warn">
                <AlertTriangle className="size-3" /> Mantenimiento
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ActionBtn
            onClick={() => void handleTest()}
            loading={test.isPending}
            icon={<Plug className="size-4" />}
          >
            Probar conexión
          </ActionBtn>
          <ActionBtn
            onClick={() => void handleDiagnose()}
            loading={diagnose.isPending}
            icon={<Stethoscope className="size-4" />}
          >
            Diagnosticar
          </ActionBtn>
          <ActionBtn
            onClick={() => void handleSync()}
            loading={sync.isPending || syncing}
            icon={<RefreshCw className="size-4" />}
            primary
          >
            {syncing ? 'Sincronizando…' : 'Sincronizar'}
          </ActionBtn>
        </div>
      </div>

      {/* Estado */}
      <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4 border-b border-[var(--color-border)]">
        <StatusBlock
          label="Última sincronización"
          value={
            syncing
              ? 'Sincronizando…'
              : provider.lastSyncAt
                ? `${new Date(provider.lastSyncAt).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}`
                : 'Nunca'
          }
          sub={
            syncing
              ? syncResultText(provider.lastSyncResult)
              : provider.lastSyncAt == null
                ? 'Corré "Sincronizar" para traer el catálogo.'
                : provider.lastSyncOk
                  ? syncResultText(provider.lastSyncResult)
                  : `Error: ${syncErrorText(provider.lastSyncResult)}`
          }
          tone={
            syncing
              ? 'neutral'
              : provider.lastSyncAt == null
                ? 'neutral'
                : provider.lastSyncOk
                  ? 'ok'
                  : 'error'
          }
        />
        <StatusBlock
          label="Último chequeo de conexión"
          value={
            provider.lastPingAt
              ? new Date(provider.lastPingAt).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })
              : 'Nunca'
          }
          sub={
            provider.lastPingAt == null
              ? 'Probá la conexión.'
              : provider.lastPingOk
                ? `OK · ${provider.lastPingLatencyMs} ms`
                : 'Sin respuesta del proveedor.'
          }
          tone={
            provider.lastPingAt == null
              ? 'neutral'
              : provider.lastPingOk
                ? 'ok'
                : 'error'
          }
        />
      </div>

      {/* Credenciales */}
      <div className="p-5 flex flex-col gap-4 border-b border-[var(--color-border)]">
        <h3 className="text-sm font-semibold">Credenciales de la API</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {credFields.map((f) => {
            const isSecret = f.kind === 'secret';
            const isTokenSet = f.key.endsWith('api_token') && provider.config.apiTokenSet;
            const secretHint = isTokenSet
              ? ' (ya configurado — vacío = no cambiar)'
              : isSecret
                ? ' (vacío = no cambiar)'
                : '';
            return (
              <Field key={f.key} label={`${f.label}${secretHint}`}>
                <input
                  type={isSecret ? 'password' : f.kind === 'number' ? 'number' : 'text'}
                  value={credValues[f.key] ?? ''}
                  onChange={(e) => setCredValue(f.key, e.target.value)}
                  placeholder={isSecret ? (isTokenSet ? '••••••••' : 'Pegá el valor') : f.placeholder}
                  className={inputCls}
                  autoComplete={isSecret ? 'new-password' : 'off'}
                />
              </Field>
            );
          })}
        </div>
        {provider.code === 'palace' && (
          <p className="text-[11px] text-[var(--color-fg-subtle)]">
            El callback token del server se configura como variable de entorno
            (más seguro) y no se edita desde acá.
          </p>
        )}
        {provider.code === 'forever' && (
          <>
            <p className="text-[11px] text-[var(--color-fg-subtle)]">
              La firma es Ed25519: la clave privada firma nuestros requests y la
              pública verifica los callbacks entrantes. Ambas se generan en el
              panel de Forever (Profile → Generate) y no se muestran una vez guardadas.
            </p>
            <div className="flex flex-col gap-1.5 rounded-[var(--radius)] border border-[var(--color-border)] p-3">
              <span className="text-[12px] font-medium">Activar callbacks (para jugar)</span>
              <span className="text-[11px] text-[var(--color-fg-muted)]">
                Registra el Agent code en el sistema para que los juegos de Forever
                puedan leer el saldo del jugador. Correlo una vez (después de guardar
                las credenciales).
              </span>
              <button
                onClick={() => void handleActivate()}
                disabled={activate.isPending}
                className="mt-1 self-start inline-flex items-center gap-2 rounded-[var(--radius)] border border-[var(--color-border)] px-4 py-2 text-[13px] font-medium transition-colors hover:border-[var(--color-fg-muted)] disabled:opacity-40"
              >
                {activate.isPending && <Loader2 className="size-4 animate-spin" />}
                Activar callbacks
              </button>
            </div>
          </>
        )}
        <button
          onClick={() => void handleSaveCreds()}
          disabled={savingCreds}
          className="self-start inline-flex items-center gap-2 rounded-[var(--radius)] bg-white px-4 py-2 text-[13px] font-semibold text-black transition-all hover:brightness-110 active:scale-[0.97] disabled:opacity-40"
        >
          {savingCreds && <Loader2 className="size-4 animate-spin" />}
          Guardar credenciales
        </button>
      </div>

      {/* Costo del proveedor (comisión sobre NetWin) */}
      <div className="p-5 flex flex-col gap-3 border-b border-[var(--color-border)]">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-semibold">Costo del proveedor</h3>
          <span className="text-[11px] text-[var(--color-fg-muted)]">
            % que el proveedor nos cobra sobre el NetWin. Se descuenta de la base
            de comisión de la red ANTES de repartir a los socios.
          </span>
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)]">
              Comisión (%)
            </span>
            <input
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={feePct}
              onChange={(e) => setFeePct(e.target.value)}
              className={`${inputCls} w-32`}
            />
          </label>
          <button
            onClick={() => void handleSaveFee()}
            disabled={savingFee}
            className="inline-flex items-center gap-2 rounded-[var(--radius)] border border-[var(--color-border)] px-4 py-2 text-[13px] font-medium transition-colors hover:border-[var(--color-fg-muted)] disabled:opacity-40"
          >
            {savingFee && <Loader2 className="size-4 animate-spin" />}
            Guardar
          </button>
        </div>
      </div>

      {/* Operación */}
      <div className="p-5 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px] font-medium">Modo mantenimiento</span>
          <span className="text-[11px] text-[var(--color-fg-muted)]">
            Apaga todos los juegos de este proveedor (se cablea el bloqueo en Fase 2).
          </span>
        </div>
        <button
          onClick={() => void handleToggleMaintenance()}
          disabled={update.isPending}
          className="inline-flex items-center gap-2 rounded-[var(--radius)] border px-4 py-2 text-[13px] font-medium transition-colors disabled:opacity-40"
          style={{
            borderColor: provider.maintenanceMode
              ? 'var(--color-warning)'
              : 'var(--color-border)',
            color: provider.maintenanceMode
              ? 'var(--color-warning)'
              : 'var(--color-fg)',
            background: 'transparent',
          }}
        >
          {update.isPending && <Loader2 className="size-4 animate-spin" />}
          {provider.maintenanceMode ? 'Desactivar mantenimiento' : 'Activar mantenimiento'}
        </button>
      </div>

      {diagOpen && (
        <DiagnoseModal
          checks={diagOpen}
          providerName={provider.displayName}
          onClose={() => setDiagOpen(null)}
        />
      )}
    </div>
  );
}

const inputCls =
  'w-full h-9 px-3 bg-[var(--color-bg-subtle)] border border-[var(--color-border)] text-[13px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] focus:outline-none focus:border-[var(--color-accent)]';

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)]">
        {label}
      </span>
      {children}
    </label>
  );
}

function ActionBtn({
  onClick,
  loading,
  icon,
  primary,
  children,
}: {
  onClick: () => void;
  loading?: boolean;
  icon: React.ReactNode;
  primary?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="inline-flex items-center gap-2 rounded-[var(--radius)] px-3.5 py-2 text-[13px] font-medium transition-all active:scale-[0.97] disabled:opacity-40"
      style={
        primary
          ? { background: 'white', color: 'black' }
          : {
              border: '1px solid var(--color-border)',
              color: 'var(--color-fg)',
            }
      }
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

function StatusBlock({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: 'ok' | 'error' | 'neutral';
}) {
  const color =
    tone === 'ok'
      ? 'var(--color-success)'
      : tone === 'error'
        ? 'var(--color-danger)'
        : 'var(--color-fg-muted)';
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-[var(--color-bg-subtle)] p-3.5">
      <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)]">
        {label}
      </span>
      <span className="text-[13px] font-medium text-[var(--color-fg)]">
        {value}
      </span>
      <span className="text-[11px]" style={{ color }}>
        {sub}
      </span>
    </div>
  );
}

function DiagnoseModal({
  checks,
  providerName,
  onClose,
}: {
  checks: DiagnoseCheck[];
  providerName: string;
  onClose: () => void;
}) {
  const failed = checks.filter((c) => !c.ok).length;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius-lg)] w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-[var(--color-border)] flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold">
              Diagnóstico · {providerName}
            </span>
            <span
              className="text-[11px]"
              style={{
                color: failed === 0 ? 'var(--color-success)' : 'var(--color-danger)',
              }}
            >
              {failed === 0
                ? 'Todo OK'
                : `${failed} chequeo${failed > 1 ? 's' : ''} con problema`}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
          >
            <X className="size-4" />
          </button>
        </div>
        <ul className="flex flex-col">
          {checks.map((c) => (
            <li
              key={c.key}
              className="flex items-start gap-3 p-4 border-b border-[var(--color-border)] last:border-0"
            >
              <span
                className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full"
                style={{
                  background: c.ok
                    ? 'var(--color-success-subtle, rgba(34,197,94,0.15))'
                    : 'rgba(239,68,68,0.15)',
                  color: c.ok ? 'var(--color-success)' : 'var(--color-danger)',
                }}
              >
                {c.ok ? <Check className="size-3" /> : <X className="size-3" />}
              </span>
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-[13px] font-medium text-[var(--color-fg)]">
                  {c.label}
                </span>
                <span className="text-[11px] text-[var(--color-fg-muted)] break-words">
                  {c.detail}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function syncResultText(result: unknown): string {
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    const n = (v: unknown) => (typeof v === 'number' ? v : 0);
    if (r.phase === 'syncing') {
      return `Sincronizando… vendor ${n(r.vendorsProcessed)}/${n(r.vendors)} · ${n(r.fetched)} juegos`;
    }
    if ('vendors' in r) {
      // Forever: vendors · juegos · dados de baja.
      return `${n(r.vendors)} vendors · ${n(r.fetched)} juegos · ${n(r.deactivated)} dados de baja`;
    }
    if ('created' in r) {
      // Palace: nuevos · actualizados · desactivados.
      return `${n(r.created)} nuevos · ${n(r.updated)} actualizados · ${n(r.deactivated)} desactivados`;
    }
  }
  return 'OK';
}

function syncErrorText(result: unknown): string {
  if (result && typeof result === 'object' && 'error' in result) {
    return String(result.error);
  }
  return 'desconocido';
}
