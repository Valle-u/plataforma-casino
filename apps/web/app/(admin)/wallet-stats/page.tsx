/**
 * /wallet-stats — Estadísticas de pago (Sprint 45).
 *
 * Reporting consolidado read-only sobre `wallet_transactions`. Pedido
 * del dueño 2026-05-20: "todos los movimientos de fichas a usuarios
 * finales, cajeros, socios, distribuidores, con trazabilidad correcta."
 *
 * Tabs:
 *   - Movimientos: tabla filtrable detallada (tx individuales).
 *   - Resumen: KPIs por bucket + breakdown por type.
 *   - Por rol: matriz inflow/outflow/net por rol del owner del wallet.
 *
 * Permisos:
 *   - `wallet_stats.view_any` ve todo el tenant.
 *   - `wallet_stats.view_own_network` ve solo red downstream (backend filtra).
 *   - `wallet_stats.export` desbloquea botón CSV.
 */

'use client';

import { ArrowDown, ArrowUp, FileBarChart2, Filter, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CsvExportButton } from '@/components/ui/csv-export-button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import {
  ROLE_LABELS,
  TX_TYPE_GROUPS,
  TX_TYPE_LABELS,
  buildExportUrl,
  useWalletStatsByRole,
  useWalletStatsMovements,
  useWalletStatsSummary,
  type MovementRow,
  type MovementsFilters,
  type WalletTxType,
} from '@/lib/hooks/use-wallet-stats';

type Tab = 'movements' | 'summary' | 'by-role';

const TABS: { id: Tab; label: string }[] = [
  { id: 'movements', label: 'Movimientos' },
  { id: 'summary', label: 'Resumen' },
  { id: 'by-role', label: 'Por rol' },
];

const ROLE_FILTER_OPTIONS = [
  'usuario_final',
  'cajero',
  'distribuidor',
  'socio',
  'admin_tenant',
  'empleado',
];

const PAGE_SIZE = 50;

export default function WalletStatsPage() {
  const [tab, setTab] = useState<Tab>('movements');

  // Filtros compartidos. Mantienen estado entre tabs.
  const [filters, setFilters] = useState<MovementsFilters>({
    limit: PAGE_SIZE,
    offset: 0,
  });

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <header className="flex items-end justify-between gap-6 pb-2">
        <div className="flex flex-col gap-2">
          <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
            <FileBarChart2 className="size-3" />
            Reporting · Wallet
          </span>
          <h1 className="font-display text-[2.5rem] leading-none tracking-tight">
            Estadísticas de pago
          </h1>
          <p className="text-sm text-[var(--color-fg-muted)] mt-1">
            Trazabilidad de todos los movimientos de fichas: cargas, retiros,
            mints, transferencias, comisiones, bonos.{' '}
            <span className="text-[var(--color-fg-subtle)]">
              Read-only sobre `wallet_transactions`.
            </span>
          </p>
        </div>
        {/* `buildExportUrl` ya arma el path + query con la MISMA serialización
            que /movements (que funciona). Lo pasamos como `path` al
            CsvExportButton, que hace el fetch autenticado (Authorization +
            X-Tenant-Host) y baja el blob — un <a download> nativo no manda
            esos headers y el backend respondía 401/404. */}
        <CsvExportButton
          path={buildExportUrl(filters)}
          filenameHint="wallet_stats"
          entityLabel="estadísticas de pago"
          label="Exportar CSV"
        />
      </header>

      {/* Tabs */}
      <div className="flex items-center gap-px bg-[var(--color-border)] border border-[var(--color-border)] self-start">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'px-4 h-8 text-[11px] uppercase tracking-[0.08em] font-medium',
              'transition-colors duration-150',
              tab === t.id
                ? 'bg-[var(--color-bg)] text-[var(--color-fg)] border-b-2 border-b-[var(--color-accent)]'
                : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filtros (compartidos por movements + summary + by-role) */}
      <FiltersBar filters={filters} onChange={setFilters} />

      {tab === 'movements' && <MovementsTab filters={filters} onPage={(o) => setFilters({ ...filters, offset: o })} />}
      {tab === 'summary' && <SummaryTab filters={filters} />}
      {tab === 'by-role' && <ByRoleTab filters={filters} />}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Filtros sticky
// ──────────────────────────────────────────────────────────────────────

function FiltersBar({
  filters,
  onChange,
}: {
  filters: MovementsFilters;
  onChange: (f: MovementsFilters) => void;
}) {
  const selectedTypes = useMemo(
    () => (Array.isArray(filters.type) ? filters.type : filters.type ? [filters.type] : []),
    [filters.type],
  );
  const selectedRoles = useMemo(
    () => (Array.isArray(filters.ownerRole) ? filters.ownerRole : filters.ownerRole ? [filters.ownerRole] : []),
    [filters.ownerRole],
  );

  function toggleType(t: WalletTxType) {
    const next = selectedTypes.includes(t)
      ? selectedTypes.filter((x) => x !== t)
      : [...selectedTypes, t];
    onChange({ ...filters, type: next.length ? next : undefined, offset: 0 });
  }
  function toggleRole(r: string) {
    const next = selectedRoles.includes(r)
      ? selectedRoles.filter((x) => x !== r)
      : [...selectedRoles, r];
    onChange({ ...filters, ownerRole: next.length ? next : undefined, offset: 0 });
  }
  function clearAll() {
    onChange({ limit: PAGE_SIZE, offset: 0 });
  }

  const activeCount =
    selectedTypes.length +
    selectedRoles.length +
    (filters.dateFrom ? 1 : 0) +
    (filters.dateTo ? 1 : 0) +
    (filters.userId ? 1 : 0) +
    (filters.actorId ? 1 : 0);

  return (
    <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium flex items-center gap-2">
          <Filter className="size-3" />
          Filtros {activeCount > 0 && <Badge variant="neutral">{activeCount}</Badge>}
        </span>
        {activeCount > 0 && (
          <Button variant="ghost" size="sm" onClick={clearAll}>
            Limpiar
          </Button>
        )}
      </div>

      {/* Date range + user filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ws-date-from">Desde</Label>
          <Input
            id="ws-date-from"
            type="datetime-local"
            value={filters.dateFrom ? filters.dateFrom.slice(0, 16) : ''}
            onChange={(e) =>
              onChange({
                ...filters,
                dateFrom: e.target.value ? new Date(e.target.value).toISOString() : undefined,
                offset: 0,
              })
            }
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ws-date-to">Hasta</Label>
          <Input
            id="ws-date-to"
            type="datetime-local"
            value={filters.dateTo ? filters.dateTo.slice(0, 16) : ''}
            onChange={(e) =>
              onChange({
                ...filters,
                dateTo: e.target.value ? new Date(e.target.value).toISOString() : undefined,
                offset: 0,
              })
            }
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ws-user-id">User ID (owner)</Label>
          <Input
            id="ws-user-id"
            placeholder="UUID o vacío"
            value={filters.userId ?? ''}
            onChange={(e) =>
              onChange({ ...filters, userId: e.target.value || undefined, offset: 0 })
            }
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ws-actor-id">Actor ID (created_by)</Label>
          <Input
            id="ws-actor-id"
            placeholder="UUID o vacío"
            value={filters.actorId ?? ''}
            onChange={(e) =>
              onChange({ ...filters, actorId: e.target.value || undefined, offset: 0 })
            }
          />
        </div>
      </div>

      {/* Owner roles */}
      <div className="flex flex-col gap-2">
        <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)]">
          Rol del owner del wallet
        </span>
        <div className="flex flex-wrap gap-1.5">
          {ROLE_FILTER_OPTIONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => toggleRole(r)}
              className={cn(
                'px-2.5 h-7 text-[11px] border transition-colors',
                selectedRoles.includes(r)
                  ? 'bg-[var(--color-accent)] text-[var(--color-accent-fg)] border-[var(--color-accent)]'
                  : 'bg-[var(--color-bg)] text-[var(--color-fg-muted)] border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-fg)]',
              )}
            >
              {ROLE_LABELS[r] ?? r}
            </button>
          ))}
        </div>
      </div>

      {/* Type filters por grupo */}
      <div className="flex flex-col gap-2">
        <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)]">
          Tipos de movimiento
        </span>
        <div className="flex flex-col gap-2">
          {TX_TYPE_GROUPS.map((g) => (
            <div key={g.label} className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] text-[var(--color-fg-subtle)] uppercase tracking-[0.06em] min-w-[80px]">
                {g.label}:
              </span>
              {g.types.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleType(t)}
                  className={cn(
                    'px-2 h-6 text-[10px] border transition-colors',
                    selectedTypes.includes(t)
                      ? 'bg-[var(--color-accent)] text-[var(--color-accent-fg)] border-[var(--color-accent)]'
                      : 'bg-[var(--color-bg)] text-[var(--color-fg-muted)] border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-fg)]',
                  )}
                  title={TX_TYPE_LABELS[t]}
                >
                  {t}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Tab: Movimientos
// ──────────────────────────────────────────────────────────────────────

function MovementsTab({
  filters,
  onPage,
}: {
  filters: MovementsFilters;
  onPage: (offset: number) => void;
}) {
  const { data, isLoading, isError, refetch, isFetching } = useWalletStatsMovements(filters);
  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const limit = data?.limit ?? PAGE_SIZE;
  const offset = data?.offset ?? 0;

  return (
    <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
      <div className="px-3 py-2 border-b border-[var(--color-border)] flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium">
          {isLoading ? 'Cargando…' : `${total} movimientos · página ${Math.floor(offset / limit) + 1}`}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={cn('size-3', isFetching && 'animate-spin')} />
          Refrescar
        </Button>
      </div>

      {isLoading ? (
        <div className="p-4 flex flex-col gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          hint="movements"
          label="Error al cargar — verificá la conexión o intentá refrescar."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          hint="movements"
          label="Sin movimientos para los filtros aplicados."
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Fecha</TH>
                <TH>Tipo</TH>
                <TH className="text-right">Monto</TH>
                <TH>Owner</TH>
                <TH>Rol</TH>
                <TH>Actor</TH>
                <TH>Fuente</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <MovementRowComponent key={r.id} row={r} />
              ))}
            </TBody>
          </Table>

          {/* Paginación */}
          <div className="px-3 py-2 border-t border-[var(--color-border)] flex items-center justify-between">
            <span className="text-[11px] text-[var(--color-fg-subtle)] num">
              Mostrando {offset + 1}-{offset + rows.length} de {total}
            </span>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={offset === 0}
                onClick={() => onPage(Math.max(0, offset - limit))}
              >
                ← Anterior
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!data?.hasMore}
                onClick={() => onPage(offset + limit)}
              >
                Siguiente →
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function MovementRowComponent({ row }: { row: MovementRow }) {
  const isIn = row.direction === 'in';
  return (
    <TR>
      <TD className="num text-[11px] text-[var(--color-fg-muted)]">
        {new Date(row.createdAt).toLocaleString('es-AR', {
          day: '2-digit',
          month: '2-digit',
          year: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </TD>
      <TD>
        <div className="flex items-center gap-1.5">
          {isIn ? (
            <ArrowDown className="size-3 text-[var(--color-success)]" />
          ) : (
            <ArrowUp className="size-3 text-[var(--color-accent-text)]" />
          )}
          <span className="text-[12px]">{TX_TYPE_LABELS[row.type] ?? row.type}</span>
        </div>
      </TD>
      <TD className="text-right num font-mono">
        <span
          className={cn(
            isIn ? 'text-[var(--color-success)]' : 'text-[var(--color-accent-text)]',
          )}
        >
          {isIn ? '+' : '−'}
          {row.amount}
        </span>
      </TD>
      <TD>
        <div className="flex flex-col">
          <span className="text-[12px] text-[var(--color-fg)]">{row.ownerDisplayName}</span>
          <span className="text-[10px] text-[var(--color-fg-subtle)] font-mono">
            @{row.ownerUsername}
          </span>
        </div>
      </TD>
      <TD>
        {row.ownerRole ? (
          <Badge variant="neutral">{ROLE_LABELS[row.ownerRole] ?? row.ownerRole}</Badge>
        ) : (
          <span className="text-[11px] text-[var(--color-fg-disabled)]">—</span>
        )}
      </TD>
      <TD>
        {row.actorUsername ? (
          <div className="flex flex-col">
            <span className="text-[11px] text-[var(--color-fg-muted)] font-mono">
              @{row.actorUsername}
            </span>
            {row.actorRole && (
              <span className="text-[10px] text-[var(--color-fg-subtle)]">
                {ROLE_LABELS[row.actorRole] ?? row.actorRole}
              </span>
            )}
          </div>
        ) : (
          <span className="text-[11px] text-[var(--color-fg-disabled)]">sistema</span>
        )}
      </TD>
      <TD className="text-[11px] text-[var(--color-fg-muted)]">{row.source ?? '—'}</TD>
    </TR>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Tab: Resumen
// ──────────────────────────────────────────────────────────────────────

function SummaryTab({ filters }: { filters: MovementsFilters }) {
  const { data, isLoading, isError } = useWalletStatsSummary({
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }
  if (isError || !data) {
    return (
      <EmptyState hint="summary" label="Error al cargar resumen — verificá la conexión." />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Kpi
          label="Total entradas"
          value={data.totalIn}
          color="success"
          icon={<ArrowDown className="size-4" />}
        />
        <Kpi
          label="Total salidas"
          value={data.totalOut}
          color="accent"
          icon={<ArrowUp className="size-4" />}
        />
        <Kpi
          label="Neto"
          value={data.net}
          color={Number(data.net) >= 0 ? 'success' : 'accent'}
        />
      </div>

      {/* Ventana + count */}
      <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] p-4 flex items-center justify-between text-[12px]">
        <span className="text-[var(--color-fg-muted)]">
          Ventana:{' '}
          <span className="text-[var(--color-fg)] font-mono">
            {new Date(data.dateFrom).toLocaleDateString('es-AR')} →{' '}
            {new Date(data.dateTo).toLocaleDateString('es-AR')}
          </span>{' '}
          <Badge variant="neutral">{data.bucket}</Badge>
        </span>
        <span className="text-[var(--color-fg-muted)]">
          Total transacciones:{' '}
          <span className="text-[var(--color-fg)] font-mono num">{data.txCount}</span>
        </span>
      </div>

      {/* Breakdown por type */}
      <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
        <div className="px-3 py-2 border-b border-[var(--color-border)]">
          <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium">
            Por tipo de movimiento
          </span>
        </div>
        <Table>
          <THead>
            <TR>
              <TH>Tipo</TH>
              <TH className="text-right">Transacciones</TH>
              <TH className="text-right">Monto total</TH>
            </TR>
          </THead>
          <TBody>
            {Object.keys(data.countByType).length === 0 ? (
              <TR>
                <TD colSpan={3}>
                  <EmptyState hint="data" label="Sin movimientos en la ventana seleccionada." />
                </TD>
              </TR>
            ) : (
              Object.entries(data.countByType)
                .sort(([, a], [, b]) => b - a)
                .map(([type, count]) => (
                  <TR key={type}>
                    <TD className="text-[12px]">
                      {TX_TYPE_LABELS[type as WalletTxType] ?? type}
                    </TD>
                    <TD className="text-right num">{count}</TD>
                    <TD className="text-right num font-mono">
                      {data.amountByType[type] ?? '0'}
                    </TD>
                  </TR>
                ))
            )}
          </TBody>
        </Table>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: string;
  color: 'success' | 'accent';
  icon?: React.ReactNode;
}) {
  return (
    <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] p-4 flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] flex items-center gap-1.5">
        {icon}
        {label}
      </span>
      <span
        className={cn(
          'text-[1.75rem] font-mono num leading-none',
          color === 'success'
            ? 'text-[var(--color-success)]'
            : 'text-[var(--color-accent-text)]',
        )}
      >
        {value}
      </span>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Tab: Por rol
// ──────────────────────────────────────────────────────────────────────

function ByRoleTab({ filters }: { filters: MovementsFilters }) {
  const { data, isLoading, isError } = useWalletStatsByRole({
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
  });

  if (isLoading) {
    return <Skeleton className="h-64" />;
  }
  if (isError || !data) {
    return <EmptyState hint="by-role" label="Error al cargar — verificá la conexión." />;
  }

  return (
    <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
      <div className="px-3 py-2 border-b border-[var(--color-border)]">
        <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)] font-medium">
          Flujo neto de fichas por rol del owner
        </span>
      </div>
      {data.length === 0 ? (
        <EmptyState
          hint="data"
          label="Sin movimientos en la ventana seleccionada."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Rol</TH>
              <TH className="text-right">Users únicos</TH>
              <TH className="text-right">Transacciones</TH>
              <TH className="text-right">Entradas</TH>
              <TH className="text-right">Salidas</TH>
              <TH className="text-right">Neto</TH>
            </TR>
          </THead>
          <TBody>
            {data.map((r) => (
              <TR key={r.role}>
                <TD>
                  <Badge variant="neutral">{ROLE_LABELS[r.role] ?? r.role}</Badge>
                </TD>
                <TD className="text-right num">{r.uniqueUsers}</TD>
                <TD className="text-right num">{r.txCount}</TD>
                <TD className="text-right num font-mono text-[var(--color-success)]">
                  +{r.inflow}
                </TD>
                <TD className="text-right num font-mono text-[var(--color-accent-text)]">
                  −{r.outflow}
                </TD>
                <TD
                  className={cn(
                    'text-right num font-mono',
                    Number(r.net) >= 0
                      ? 'text-[var(--color-success)]'
                      : 'text-[var(--color-accent-text)]',
                  )}
                >
                  {Number(r.net) >= 0 ? '+' : ''}
                  {r.net}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
