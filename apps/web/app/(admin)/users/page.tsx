/**
 * /users — lista + create modal + acciones inline por fila.
 *
 * Sprint 51.10 — pasada de polish:
 *   - Header con stats agregados (count por rol + activos 24h/7d +
 *     creados última semana).
 *   - Filtros adicionales: tab por rol (todos, admin, socio, cajero,
 *     player, …).
 *   - Tabla enriquecida: avatar + nombre + rol chip + parent link +
 *     balance wallet + último login relativo + status badge.
 *   - Click en nombre → página /users/:id (perfil completo).
 *   - Acciones inline por fila: cargar, retirar, corrección, bono,
 *     bloquear, impersonar, ver.
 *
 * Sprint 55.x — mobile-first:
 *   - En < lg la tabla densa se reemplaza por UserCardList (cards
 *     apilados con botones full-width â‰¥44px). Desktop NO cambia.
 */

'use client';

import { Mail, Plus, RefreshCw, Search, Users } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { CreateUserModal } from '@/components/admin/create-user-modal';
import { UserActionsCell } from '@/components/admin/user-actions-cell';
import { UserCardList } from '@/components/admin/user-card-list';
import {
  RolesChips,
  StatusDot,
  ROLE_SHORT_LABEL,
} from '@/components/admin/user-presentation';
import { Button } from '@/components/ui/button';
import { CsvExportButton } from '@/components/ui/csv-export-button';
import { EmptyState } from '@/components/ui/empty-state';
import { HelpNote } from '@/components/ui/help-note';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { useDebouncedValue } from '@/lib/hooks/use-debounced-value';
import { useUsersList, useUsersStats } from '@/lib/hooks/use-users';
import { cn } from '@/lib/cn';

const STATUS_FILTERS = ['todos', 'active', 'inactive', 'banned'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

/** Etiquetas en criollo para los filtros de estado (el valor va al backend). */
const STATUS_LABELS: Record<StatusFilter, string> = {
  todos: 'Todos',
  active: 'Activos',
  inactive: 'Inactivos',
  banned: 'Bloqueados',
};

const PAGE_SIZE = 50;

export default function UsersPage() {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 300);
  const [status, setStatus] = useState<StatusFilter>('todos');
  const [roleFilter, setRoleFilter] = useState<string>('todos');
  const [page, setPage] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);

  const stats = useUsersStats();

  const filters = {
    search: debouncedQuery,
    status: status === 'todos' ? undefined : status,
    role: roleFilter === 'todos' ? undefined : roleFilter,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  };

  const { data, isLoading, isError, refetch, isFetching } = useUsersList(
    filters,
    // Sprint 55: polling del listado para que walletBalance/bonusBalance
    // se reflejen sin refresco manual (el balance cambia por fuentes fuera
    // de este tab: juego del player, depósitos self-service, otro admin).
    { refetchInterval: 20_000 },
  );
  const rows = data?.data ?? [];
  const total = data?.total ?? 0;

  // El CSV respeta los MISMOS filtros que la tabla (search/status/role). El
  // scope de jerarquía lo aplica el backend. Sin limit/offset: el export
  // trae todo lo filtrado hasta el cap del server.
  const exportPath = useMemo(() => {
    const p = new URLSearchParams();
    if (debouncedQuery) p.set('search', debouncedQuery);
    if (status !== 'todos') p.set('status', status);
    if (roleFilter !== 'todos') p.set('role', roleFilter);
    const q = p.toString();
    return q ? `/tenant/users/export?${q}` : '/tenant/users/export';
  }, [debouncedQuery, status, roleFilter]);

  const roleTabs = useMemo(() => {
    const list: Array<{ code: string; label: string; count: number }> = [
      { code: 'todos', label: 'todos', count: stats.data?.total ?? 0 },
    ];
    for (const r of stats.data?.byRole ?? []) {
      list.push({
        code: r.code,
        label: ROLE_SHORT_LABEL[r.code] ?? r.code,
        count: r.count,
      });
    }
    return list;
  }, [stats.data]);

  const onSuccess = () => {
    void refetch();
    void stats.refetch();
  };

  return (
    <>
      <PageShell>
        <PageHeader
          icon={Users}
          title="Usuarios"
          description={
            data
              ? `${rows.length} de ${total} — jugadores, cajeros, socios y empleados de tu red.`
              : 'Cargando…'
          }
          actions={
            <>
              <CsvExportButton
                path={exportPath}
                filenameHint="users"
                permission="users.export"
                entityLabel="usuarios"
                className="h-12 lg:h-8"
              />
              <Button
                variant="secondary"
                size="md"
                onClick={() => { void refetch(); void stats.refetch(); }}
                disabled={isFetching}
                className="h-12 lg:h-8"
              >
                <RefreshCw className={cn('size-3.5', isFetching && 'animate-spin')} />
                Refrescar
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={() => setCreateOpen(true)}
                className="h-12 lg:h-8"
              >
                <Plus className="size-3.5" />
                Crear usuario
              </Button>
            </>
          }
        />

        <HelpNote id="users">
          Acá ves a todas las personas de tu red. <strong>Buscá</strong> por
          nombre, usuario o email; <strong>filtrá</strong> por estado (activos,
          bloqueados…) o por rol (jugadores, cajeros, socios…). Tocá un nombre
          para ver su <strong>perfil completo</strong> (saldo, historial,
          acciones). Con <strong>Crear usuario</strong> das de alta a alguien
          nuevo.
        </HelpNote>

        {/* Stats */}
        <StatsStrip stats={stats.data} loading={stats.isLoading} />

        {/* Toolbar */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[var(--color-fg-subtle)] pointer-events-none" />
              <Input
                placeholder="Buscar por nombre, usuario o email…"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setPage(0); }}
                className="pl-9 h-11 lg:h-9"
              />
            </div>
            <div className="flex flex-wrap items-center gap-px bg-[var(--color-border)] border border-[var(--color-border)]">
              {STATUS_FILTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => { setStatus(s); setPage(0); }}
                  className={cn(
                    'px-3 h-8 text-[11px] uppercase tracking-[0.08em] font-medium transition-colors duration-150',
                    status === s
                      ? 'bg-[var(--color-bg)] text-[var(--color-fg)] border-b-2 border-b-[var(--color-accent)]'
                      : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]',
                  )}
                >
                  {STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-px bg-[var(--color-border)] border border-[var(--color-border)] self-start flex-wrap">
            {roleTabs.map((t) => (
              <button
                key={t.code}
                type="button"
                onClick={() => { setRoleFilter(t.code); setPage(0); }}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 h-8 text-[11px] uppercase tracking-[0.08em] font-medium transition-colors duration-150',
                  roleFilter === t.code
                    ? 'bg-[var(--color-bg)] text-[var(--color-fg)] border-b-2 border-b-[var(--color-accent)]'
                    : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]',
                )}
              >
                <span>{t.label}</span>
                <span className="text-[10px] font-mono tabular-nums text-[var(--color-fg-subtle)]">
                  {t.count}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Lista */}
        <div className="relative">
          {/* Fetching overlay — visible when refetching with placeholder data */}
          {isFetching && !isLoading && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-[var(--color-bg)]/60 backdrop-blur-[1px]">
              <div className="flex items-center gap-2 text-[11px] text-[var(--color-fg-subtle)]">
                <Spinner size="sm" />
                <span className="uppercase tracking-[0.08em]">Actualizando…</span>
              </div>
            </div>
          )}

          {/* Card list (mobile) */}
          <div className="flex flex-col gap-3 lg:hidden">
            {isLoading ? (
              <LoadingCards />
            ) : isError ? (
              <div className="p-6 bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
                <ListState
                  type="error"
                  query={query}
                  status={status}
                  roleFilter={roleFilter}
                  onRetry={() => { void refetch(); }}
                  onCreateFirst={() => setCreateOpen(true)}
                />
              </div>
            ) : rows.length === 0 ? (
              <div className="p-6 bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
                <ListState
                  type="empty"
                  query={query}
                  status={status}
                  roleFilter={roleFilter}
                  onRetry={() => { void refetch(); }}
                  onCreateFirst={() => setCreateOpen(true)}
                />
              </div>
            ) : (
              <UserCardList rows={rows} onSuccess={onSuccess} />
            )}
          </div>

          {/* Table (desktop) */}
          <div className="hidden lg:block bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto">
            {isLoading ? (
              <LoadingTable />
            ) : isError ? (
              <div className="p-6">
                <ListState
                  type="error"
                  query={query}
                  status={status}
                  roleFilter={roleFilter}
                  onRetry={() => { void refetch(); }}
                  onCreateFirst={() => setCreateOpen(true)}
                />
              </div>
            ) : rows.length === 0 ? (
              <div className="p-6">
                <ListState
                  type="empty"
                  query={query}
                  status={status}
                  roleFilter={roleFilter}
                  onRetry={() => { void refetch(); }}
                  onCreateFirst={() => setCreateOpen(true)}
                />
              </div>
            ) : (
              <Table className="w-full min-w-[720px]">
                <THead>
                  <tr>
                    <TH>Usuario</TH>
                    <TH>Contacto</TH>
                    <TH className="w-[150px]">Rol</TH>
                    <TH className="w-[120px]" align="right">Saldo</TH>
                    <TH className="w-[110px]">Estado</TH>
                    <TH align="right">Acciones</TH>
                  </tr>
                </THead>
                <TBody>
                  {rows.map((u, i) => (
                    <TR
                      key={u.id}
                      className="animate-fade-up-staggered"
                      style={{ animationDelay: `${Math.min(i * 30, 600)}ms` }}
                    >
                      {/* Usuario: nombre + @usuario */}
                      <TD>
                        <Link
                          href={`/users/${u.id}`}
                          className="group flex flex-col min-w-0"
                        >
                          <span className="text-[13px] text-[var(--color-fg)] truncate group-hover:text-[var(--color-accent-text)] transition-colors">
                            {u.displayName || u.username}
                          </span>
                          <span className="text-[11px] text-[var(--color-fg-subtle)] font-mono truncate">
                            @{u.username}
                          </span>
                        </Link>
                      </TD>
                      {/* Contacto: email */}
                      <TD>
                        {u.email ? (
                          <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--color-fg-muted)] max-w-full">
                            <Mail className="size-3.5 shrink-0 text-[var(--color-fg-subtle)]" />
                            <span className="truncate">{u.email}</span>
                          </span>
                        ) : (
                          <span className="text-[var(--color-fg-subtle)]">—</span>
                        )}
                      </TD>
                      <TD>
                        <RolesChips codes={u.roleCodes} />
                      </TD>
                      <TD numeric>
                        {u.walletBalance === null ? (
                          <span className="text-[var(--color-fg-subtle)]">—</span>
                        ) : (
                          <span className="text-[13px] font-mono tabular-nums text-[var(--color-fg)]">
                            ${Number(u.walletBalance).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                          </span>
                        )}
                      </TD>
                      <TD>
                        <StatusDot status={u.status} />
                      </TD>
                      <TD>
                        <UserActionsCell user={u} onSuccess={onSuccess} />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </div>
        </div>

        {/* Pager */}
        {data && total > PAGE_SIZE && (
          <Pager
            page={page}
            total={total}
            onPrev={() => setPage((p) => Math.max(0, p - 1))}
            onNext={() => setPage((p) => p + 1)}
            hasMore={(page + 1) * PAGE_SIZE < total}
          />
        )}
      </PageShell>

      <CreateUserModal open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// ListState — error/empty compartido entre card list y tabla
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function ListState({
  type,
  query,
  status,
  roleFilter,
  onRetry,
  onCreateFirst,
}: {
  type: 'error' | 'empty';
  query: string;
  status: StatusFilter;
  roleFilter: string;
  onRetry: () => void;
  onCreateFirst: () => void;
}) {
  if (type === 'error') {
    return (
      <EmptyState
        hint="users"
        label="No se pudo cargar la lista. Verificá tu sesión."
        action={
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Reintentar
          </Button>
        }
      />
    );
  }
  const noFilters = !query && status === 'todos' && roleFilter === 'todos';
  return (
    <EmptyState
      hint="users"
      label={noFilters ? 'Todavía no hay usuarios cargados.' : 'Ningún usuario coincide con los filtros.'}
      action={
        noFilters ? (
          <Button variant="primary" size="sm" onClick={onCreateFirst}>
            <Plus className="size-3.5" />
            Crear primer usuario
          </Button>
        ) : undefined
      }
    />
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Stats strip
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function StatsStrip({
  stats,
  loading,
}: {
  stats:
    | {
        total: number;
        byStatus: Record<string, number>;
        activeLast24h: number;
        activeLast7d: number;
        createdLast7d: number;
      }
    | undefined;
  loading: boolean;
}) {
  if (loading && !stats) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full bg-[var(--color-bg-subtle)]" />
        ))}
      </div>
    );
  }
  if (!stats) return null;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      <StatTile
        label="Total"
        value={stats.total.toLocaleString()}
        hint={`${stats.byStatus.active ?? 0} activos · ${stats.byStatus.banned ?? 0} bloqueados`}
      />
      <StatTile
        label="Activos últimas 24h"
        value={stats.activeLast24h.toLocaleString()}
        hint={`${pct(stats.activeLast24h, stats.total)}% del total`}
        accent={stats.activeLast24h > 0 ? 'success' : 'neutral'}
      />
      <StatTile
        label="Activos últimos 7 días"
        value={stats.activeLast7d.toLocaleString()}
        hint={`${pct(stats.activeLast7d, stats.total)}% del total`}
        accent={stats.activeLast7d > 0 ? 'success' : 'neutral'}
      />
      <StatTile
        label="Nuevos esta semana"
        value={stats.createdLast7d.toLocaleString()}
        hint={stats.createdLast7d > 0 ? `+${stats.createdLast7d} en 7 días` : 'Sin altas recientes'}
        accent={stats.createdLast7d > 0 ? 'accent' : 'neutral'}
      />
    </div>
  );
}

function StatTile({
  label,
  value,
  hint,
  accent = 'neutral',
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: 'neutral' | 'success' | 'accent';
}) {
  return (
    <div
      className={cn(
        'px-3 py-2.5 bg-[var(--color-bg-elevated)] border border-[var(--color-border)]',
        accent === 'success' && 'border-l-2 border-l-[var(--color-success)]',
        accent === 'accent' && 'border-l-2 border-l-[var(--color-accent)]',
      )}
    >
      <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)]">{label}</div>
      <div className="font-display text-2xl tabular-nums tracking-tight text-[var(--color-fg)] mt-0.5">{value}</div>
      {hint && <div className="text-[10px] text-[var(--color-fg-subtle)] mt-0.5">{hint}</div>}
    </div>
  );
}

function pct(part: number, total: number): string {
  if (!total) return '0';
  return ((part / total) * 100).toFixed(0);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Loading skeletons
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function LoadingCards() {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-44 w-full bg-[var(--color-bg-subtle)]" />
      ))}
    </div>
  );
}

function LoadingTable() {
  return (
    <div className="p-4 flex flex-col gap-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full bg-[var(--color-bg-subtle)]" />
      ))}
    </div>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Pager
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function Pager({
  page,
  total,
  onPrev,
  onNext,
  hasMore,
}: {
  page: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  hasMore: boolean;
}) {
  const start = page * PAGE_SIZE + 1;
  const end = Math.min(start + PAGE_SIZE - 1, total);
  return (
    <div className="flex flex-wrap items-center justify-end gap-3 text-[11px] text-[var(--color-fg-subtle)]">
      <span className="font-mono tabular-nums">
        {total === 0 ? '—' : `${start}–${end} de ${total}`}
      </span>
      <div className="flex items-center gap-px bg-[var(--color-border)]">
        <button
          type="button"
          onClick={onPrev}
          disabled={page === 0}
          className="px-4 h-10 lg:h-7 text-[11px] uppercase tracking-[0.08em] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Anterior
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!hasMore}
          className="px-4 h-10 lg:h-7 text-[11px] uppercase tracking-[0.08em] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}
