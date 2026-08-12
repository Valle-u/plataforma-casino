'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Gamepad2,
  Loader2,
  RefreshCw,
  Plug,
  Stethoscope,
  Check,
  X,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { isApiError } from '@/lib/api-client';
import {
  useGameProviders,
  useUpdateProvider,
  useTestProvider,
  useDiagnoseProvider,
  useSyncProvider,
  type ProviderView,
  type DiagnoseCheck,
} from '@/lib/hooks/use-game-providers';
import { useSetSetting } from '@/lib/hooks/use-tenant-settings';

const TABS = [
  { key: 'providers', label: 'Proveedores' },
  { key: 'games', label: 'Juegos' },
  { key: 'logs', label: 'Logs / Diagnóstico' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default function GameProvidersPage() {
  const [tab, setTab] = useState<TabKey>('providers');

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[920px] mx-auto">
      <header className="flex flex-col gap-2">
        <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
          <Gamepad2 className="size-3" />
          Game Providers
        </span>
        <h1 className="font-display text-3xl lg:text-[2.5rem] leading-none tracking-tight">
          Proveedores de juegos
        </h1>
        <p className="text-sm text-[var(--color-fg-muted)] mt-1">
          Configurá cada proveedor, controlá su estado y sincronizá el catálogo.
        </p>
      </header>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--color-border)]">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="relative px-4 py-2.5 text-sm font-medium transition-colors"
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
      {tab === 'games' && (
        <Placeholder
          phase="Fase 2"
          text="Acá vas a poder ver la lista de juegos, ocultarlos/deshabilitarlos, marcar destacados y ver métricas por juego."
        />
      )}
      {tab === 'logs' && (
        <Placeholder
          phase="Fase 3"
          text="Acá van a aparecer los logs de errores (sync, callbacks, launch) y el histórico de cambios de catálogo, con alertas."
        />
      )}
    </div>
  );
}

function Placeholder({ phase, text }: { phase: string; text: string }) {
  return (
    <div className="bg-[var(--color-bg-elevated)] border border-dashed border-[var(--color-border)] p-8 flex flex-col items-center gap-2 text-center">
      <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-accent-text)] font-semibold">
        {phase}
      </span>
      <p className="text-[13px] text-[var(--color-fg-muted)] max-w-[440px]">
        {text}
      </p>
    </div>
  );
}

function ProvidersTab() {
  const { data, isLoading } = useGameProviders();

  if (isLoading) {
    return (
      <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] p-6 h-[280px] animate-pulse" />
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
          fg: 'var(--color-success, #22c55e)',
          bd: 'var(--color-success, #22c55e)',
        };
      case 'warn':
        return { bg: 'rgba(234,179,8,0.12)', fg: '#eab308', bd: '#eab308' };
      case 'error':
        return { bg: 'rgba(239,68,68,0.12)', fg: '#ef4444', bd: '#ef4444' };
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

function ProviderCard({ provider }: { provider: ProviderView }) {
  const update = useUpdateProvider();
  const test = useTestProvider();
  const diagnose = useDiagnoseProvider();
  const sync = useSyncProvider();
  const setSetting = useSetSetting();
  const qc = useQueryClient();

  const [diagOpen, setDiagOpen] = useState<DiagnoseCheck[] | null>(null);
  const [savingCreds, setSavingCreds] = useState(false);
  // Form de credenciales (controlado — es un form de página, no un modal Radix).
  const [apiUrl, setApiUrl] = useState(provider.config.apiUrl ?? '');
  const [apiToken, setApiToken] = useState('');
  const [defaultLang, setDefaultLang] = useState(
    provider.config.defaultLang != null ? String(provider.config.defaultLang) : '',
  );

  const online =
    provider.lastPingOk === null
      ? null
      : provider.lastPingOk === true;

  const handleSync = async () => {
    try {
      const res = await sync.mutateAsync(provider.code);
      toast.success('Catálogo sincronizado', {
        description: `${res.created} nuevos · ${res.updated} actualizados · ${res.deactivated} desactivados`,
      });
    } catch (err) {
      toast.error('Error al sincronizar', {
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
      if (apiUrl.trim() && apiUrl.trim() !== (provider.config.apiUrl ?? '')) {
        ops.push(
          setSetting.mutateAsync({ key: 'palace.api_url', value: apiUrl.trim() }),
        );
      }
      if (apiToken.trim()) {
        ops.push(
          setSetting.mutateAsync({
            key: 'palace.api_token',
            value: apiToken.trim(),
          }),
        );
      }
      if (defaultLang.trim()) {
        const n = Number(defaultLang.trim());
        if (Number.isInteger(n) && n >= 0) {
          ops.push(
            setSetting.mutateAsync({ key: 'palace.default_lang', value: n }),
          );
        }
      }
      if (ops.length === 0) {
        toast.info('No hay cambios para guardar.');
        setSavingCreds(false);
        return;
      }
      await Promise.all(ops);
      setApiToken('');
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
    <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
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
            loading={sync.isPending}
            icon={<RefreshCw className="size-4" />}
            primary
          >
            Sincronizar
          </ActionBtn>
        </div>
      </div>

      {/* Estado */}
      <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4 border-b border-[var(--color-border)]">
        <StatusBlock
          label="Última sincronización"
          value={
            provider.lastSyncAt
              ? `${new Date(provider.lastSyncAt).toLocaleString('es-AR')}`
              : 'Nunca'
          }
          sub={
            provider.lastSyncAt == null
              ? 'Corré "Sincronizar" para traer el catálogo.'
              : provider.lastSyncOk
                ? syncResultText(provider.lastSyncResult)
                : `Error: ${syncErrorText(provider.lastSyncResult)}`
          }
          tone={
            provider.lastSyncAt == null
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
              ? new Date(provider.lastPingAt).toLocaleString('es-AR')
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
          <Field label="API URL">
            <input
              type="text"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="https://agent.goldslotpalase.com"
              className={inputCls}
            />
          </Field>
          <Field label="Idioma default (int)">
            <input
              type="number"
              value={defaultLang}
              onChange={(e) => setDefaultLang(e.target.value)}
              placeholder="4"
              className={inputCls}
            />
          </Field>
          <Field
            label={`API Token ${provider.config.apiTokenSet ? '(ya configurado — dejá vacío para no cambiarlo)' : ''}`}
          >
            <input
              type="password"
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              placeholder={provider.config.apiTokenSet ? '••••••••' : 'Pegá el token'}
              className={inputCls}
              autoComplete="new-password"
            />
          </Field>
        </div>
        <p className="text-[11px] text-[var(--color-fg-subtle)]">
          El callback token del server se configura como variable de entorno
          (más seguro) y no se edita desde acá.
        </p>
        <button
          onClick={() => void handleSaveCreds()}
          disabled={savingCreds}
          className="self-start inline-flex items-center gap-2 rounded-[var(--radius)] bg-white px-4 py-2 text-[13px] font-semibold text-black transition-all hover:brightness-110 active:scale-[0.97] disabled:opacity-40"
        >
          {savingCreds && <Loader2 className="size-4 animate-spin" />}
          Guardar credenciales
        </button>
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
              ? '#eab308'
              : 'var(--color-border)',
            color: provider.maintenanceMode
              ? '#eab308'
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
      ? 'var(--color-success, #22c55e)'
      : tone === 'error'
        ? '#ef4444'
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
        className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-xl"
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
                color: failed === 0 ? 'var(--color-success, #22c55e)' : '#ef4444',
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
                  color: c.ok ? 'var(--color-success, #22c55e)' : '#ef4444',
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
  if (result && typeof result === 'object' && 'created' in result) {
    const r = result as {
      created: number;
      updated: number;
      deactivated: number;
    };
    return `${r.created} nuevos · ${r.updated} actualizados · ${r.deactivated} desactivados`;
  }
  return 'OK';
}

function syncErrorText(result: unknown): string {
  if (result && typeof result === 'object' && 'error' in result) {
    return String(result.error);
  }
  return 'desconocido';
}
