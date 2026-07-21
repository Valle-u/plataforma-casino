'use client';

import { useState } from 'react';
import { Dices, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { apiPost, isApiError } from '@/lib/api-client';

export default function GamesAdminPage() {
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await apiPost<{ fetched: number; created: number; updated: number; deactivated: number }>('/tenant/games/palace/sync', {});
      toast.success('Catálogo sincronizado', {
        description: `${res.created} nuevos · ${res.updated} actualizados · ${res.deactivated} desactivados`,
      });
    } catch (err) {
      toast.error('Error al sincronizar', {
        description: isApiError(err) ? err.message : 'Error de conexión',
      });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[800px] mx-auto">
      <header className="flex flex-col gap-2">
        <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
          <Dices className="size-3" />
          Juegos
        </span>
        <h1 className="font-display text-3xl lg:text-[2.5rem] leading-none tracking-tight">
          Gestión de juegos
        </h1>
        <p className="text-sm text-[var(--color-fg-muted)] mt-1">
          Sincronizá el catálogo de juegos desde Palace Casino.
        </p>
      </header>

      <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] p-6 flex flex-col gap-4">
        <h2 className="text-sm font-semibold">Sincronizar catálogo</h2>
        <p className="text-[12px] text-[var(--color-fg-muted)]">
          Trae todos los juegos activos desde Palace y los actualiza en la base de datos del tenant.
          Los juegos que ya no existen en Palace se marcan como inactivos.
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="inline-flex items-center gap-2 rounded-[var(--radius)] bg-white px-5 py-2 text-sm font-semibold text-black shadow-sm transition-all duration-150 hover:brightness-110 hover:shadow-md active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            {syncing ? 'Sincronizando…' : 'Sincronizar desde Palace'}
          </button>
        </div>
      </div>

      <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] p-6 flex flex-col gap-4">
        <h2 className="text-sm font-semibold">Configuración requerida</h2>
        <p className="text-[12px] text-[var(--color-fg-muted)]">
          Antes de sincronizar, asegurate de tener configurado el API token de Palace en Ajustes.
        </p>
        <ul className="text-[12px] text-[var(--color-fg-muted)] flex flex-col gap-1.5 list-disc list-inside">
          <li>
            <code className="text-[11px] font-mono text-[var(--color-fg)]">palace.api_token</code> — token de autenticación
          </li>
          <li>
            <code className="text-[11px] font-mono text-[var(--color-fg)]">palace.api_url</code> — URL base de la API (default: <span className="font-mono">https://agent.goldslotpalase.com</span>)
          </li>
        </ul>
        <a
          href="/settings"
          className="text-[12px] text-[var(--color-accent-text)] hover:underline self-start"
        >
          Ir a Ajustes →
        </a>
      </div>
    </div>
  );
}
