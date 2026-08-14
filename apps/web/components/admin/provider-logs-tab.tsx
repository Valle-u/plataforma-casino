'use client';

import { useState } from 'react';
import { Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import {
  useProviderLogs,
  type LogSeverity,
  type ProviderLog,
} from '@/lib/hooks/use-game-providers';

const EVENT_TYPES: { value: string; label: string }[] = [
  { value: '', label: 'Todos los eventos' },
  { value: 'sync_error', label: 'Errores de sync' },
  { value: 'catalog_change', label: 'Cambios de catálogo' },
  { value: 'callback_error', label: 'Errores de callback' },
  { value: 'launch_error', label: 'Errores de launch' },
  { value: 'ping', label: 'Healthcheck (ping)' },
];

const SEVERITIES: { value: string; label: string }[] = [
  { value: '', label: 'Toda severidad' },
  { value: 'error', label: 'Error' },
  { value: 'warning', label: 'Warning' },
  { value: 'info', label: 'Info' },
];

const PAGE_SIZE = 30;

const selectCls =
  'h-9 px-2 bg-[var(--color-bg-subtle)] border border-[var(--color-border)] text-[13px] text-[var(--color-fg)] focus:outline-none focus:border-[var(--color-accent)]';

export function ProviderLogsTab({ code = 'palace' }: { code?: string }) {
  const [eventType, setEventType] = useState('');
  const [severity, setSeverity] = useState('');
  const [page, setPage] = useState(0);

  const { data, isLoading, isFetching } = useProviderLogs(code, {
    eventType: eventType || undefined,
    severity: (severity as LogSeverity) || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const logs = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={eventType}
          onChange={(e) => {
            setEventType(e.target.value);
            setPage(0);
          }}
          className={selectCls}
        >
          {EVENT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <select
          value={severity}
          onChange={(e) => {
            setSeverity(e.target.value);
            setPage(0);
          }}
          className={selectCls}
        >
          {SEVERITIES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <span className="text-[12px] text-[var(--color-fg-muted)] ml-auto">
          {total} evento{total !== 1 ? 's' : ''}
          {isFetching && !isLoading ? ' · actualizando…' : ''}
        </span>
      </div>

      <div className="border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
        {isLoading ? (
          <div className="p-8 text-center text-[var(--color-fg-muted)]">
            <Loader2 className="size-5 animate-spin inline" />
          </div>
        ) : logs.length === 0 ? (
          <div className="p-8 text-center text-[13px] text-[var(--color-fg-muted)]">
            Sin eventos registrados. Los errores de sync, callback y launch
            aparecerán acá.
          </div>
        ) : (
          logs.map((log) => <LogRow key={log.id} log={log} />)
        )}
      </div>

      <div className="flex items-center justify-end gap-2 text-[12px] text-[var(--color-fg-muted)]">
        <button
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={page === 0}
          className="px-3 py-1 border border-[var(--color-border)] disabled:opacity-40"
        >
          Anterior
        </button>
        <span>
          {page + 1} / {totalPages}
        </span>
        <button
          onClick={() => setPage((p) => (p + 1 < totalPages ? p + 1 : p))}
          disabled={page + 1 >= totalPages}
          className="px-3 py-1 border border-[var(--color-border)] disabled:opacity-40"
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}

function LogRow({ log }: { log: ProviderLog }) {
  const [open, setOpen] = useState(false);
  const hasDetail =
    log.detail != null &&
    typeof log.detail === 'object' &&
    Object.keys(log.detail).length > 0;

  const sevColor =
    log.severity === 'error'
      ? '#ef4444'
      : log.severity === 'warning'
        ? '#eab308'
        : 'var(--color-fg-muted)';

  return (
    <div className="text-[13px]">
      <button
        onClick={() => hasDetail && setOpen((o) => !o)}
        className="w-full flex items-start gap-3 p-3 text-left hover:bg-[var(--color-bg-subtle)]"
        style={{ cursor: hasDetail ? 'pointer' : 'default' }}
      >
        <span
          className="mt-1 size-2 rounded-full shrink-0"
          style={{ background: sevColor }}
        />
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="text-[10px] font-mono uppercase tracking-[0.05em] rounded px-1.5 py-0.5"
              style={{
                border: `1px solid ${sevColor}`,
                color: sevColor,
              }}
            >
              {log.eventType}
            </span>
            <span className="text-[var(--color-fg)]">{log.message}</span>
          </div>
          <span className="text-[11px] text-[var(--color-fg-subtle)]">
            {new Date(log.createdAt).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}
          </span>
        </div>
        {hasDetail &&
          (open ? (
            <ChevronDown className="size-4 shrink-0 text-[var(--color-fg-subtle)]" />
          ) : (
            <ChevronRight className="size-4 shrink-0 text-[var(--color-fg-subtle)]" />
          ))}
      </button>
      {open && hasDetail && (
        <pre className="mx-3 mb-3 mt-0 overflow-x-auto rounded bg-[var(--color-bg-subtle)] p-3 text-[11px] font-mono text-[var(--color-fg-muted)]">
          {JSON.stringify(log.detail, null, 2)}
        </pre>
      )}
    </div>
  );
}
