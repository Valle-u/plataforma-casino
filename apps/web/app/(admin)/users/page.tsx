/**
 * /users — lista + create modal + edit drawer.
 *
 * Sprint 51.10 — pasada de polish:
 *   - Header con stats agregados (count por rol + activos 24h/7d +
 *     creados última semana).
 *   - Filtros adicionales: tab por rol (todos, admin, socio, cajero,
 *     player, …).
 *   - Tabla enriquecida: avatar + nombre + rol chip + parent link +
 *     balance wallet + último login relativo + status badge.
 *   - Click row → drawer existente.
 */

'use client';

import { Plus, RefreshCw, Search, UserRound } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CreateUserModal } from '@/components/admin/create-user-modal';
import { UserDetailDrawer } from '@/components/admin/user-detail-drawer';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CsvExportButton } from '@/components/ui/csv-export-button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { useDebouncedValue } from '@/lib/hooks/use-debounced-value';
import { useUsersList, useUsersStats } from '@/lib/hooks/use-users';
import { cn } from '@/lib/cn';

const STATUS_FILTERS = ['todos', 'active', 'banned', 'pending'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  active: 'success',
  banned: 'danger',
  suspended: 'warning',
  pending: 'neutral',
};

// Color por rol para los chips de la tabla — consistente con el sentido
// de jerarquía (admin = accent, players = neutral).
const ROLE_VARIANT: Record<string, BadgeVariant> = {
  admin_tenant: 'danger',
  socio: 'warning',
  distribuidor: 'info',
  cajero: 'info',
  empleado: 'neutral',
  usuario_final: 'neutral',
};

const ROLE_SHORT_LABEL: Record<string, string> = {
  admin_tenant: 'Admin',
  socio: 'Socio',
  distribuidor: 'Distrib.',
  cajero: 'Cajero',
  empleado: 'Empleado',
  usuario_final: 'Player',
};

const PAGE_SIZE = 50;

export default function UsersPage() {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 300);
  const [status, setStatus] = useState<StatusFilter>('todos');
  const [roleFilter, setRoleFilter] = useState<string>('todos');
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const stats = useUsersStats();

  const filters = {
    search: debouncedQuery,
    status: status === 'todos' ? undefined : (status),
    role: roleFilter === 'todos' ? undefined : roleFilter,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  };

  const { data, isLoading, isError, refetch, isFetching } = useUsersList(filters);
  const rows = data?.data ?? [];
  const total = data?.total ?? 0;

  // Tabs de rol: "todos" + cada rol del catálogo + "sin rol" como bucket
  // catch-all. Los counts vienen del stats endpoint.
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

  return (
    <>
      <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[1600px] mx-auto">
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-2">
          <div className="flex flex-col gap-2">
            <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
              <UserRound className="size-3" />
              Operativa · Usuarios
            </span>
            <h1 className="font-display text-3xl lg:text-[2.5rem] leading-none tracking-tight">
              Usuarios del tenant
            </h1>
            <p className="text-sm text-[var(--color-fg-muted)] mt-1">
              {data ? `${rows.length} de ${total} usuarios` : 'Cargando…'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CsvExportButton
              path="/tenant/users/export"
              filenameHint="users"
              entityLabel="usuarios"
            />
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                refetch();
                stats.refetch();
              }}
              disabled={isFetching}
            >
              <RefreshCw
                className={cn('size-3.5', isFetching && 'animate-spin')}
              />
              Refrescar
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="size-3.5" />
              Crear usuario
            </Button>
          </div>
        </header>

        {/* Stats strip */}
        <StatsStrip stats={stats.data} loading={stats.isLoading} />

        {/* Toolbar: search + tabs */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[var(--color-fg-subtle)] pointer-events-none" />
              <Input
                placeholder="Buscar por username, nombre o email…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
                className="pl-9"
              />
            </div>
            <div className="flex flex-wrap items-center gap-px bg-[var(--color-border)] border border-[var(--color-border)]">
              {STATUS_FILTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setStatus(s);
                    setPage(0);
                  }}
                  className={cn(
                    'px-3 h-8 text-[11px] uppercase tracking-[0.08em] font-medium',
                    'transition-colors duration-150',
                    status === s
                      ? 'bg-[var(--color-bg)] text-[var(--color-fg)] border-b-2 border-b-[var(--color-accent)]'
                      : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]',
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Tabs por rol — secundaria, más densa que los status. */}
          <div className="flex items-center gap-px bg-[var(--color-border)] border border-[var(--color-border)] self-start flex-wrap">
            {roleTabs.map((t) => (
              <button
                key={t.code}
                type="button"
                onClick={() => {
                  setRoleFilter(t.code);
                  setPage(0);
                }}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 h-8 text-[11px] uppercase tracking-[0.08em] font-medium',
                  'transition-colors duration-150',
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

        {/* Table */}
        <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto">
          {isLoading ? (
            <LoadingTable />
          ) : isError ? (
            <div className="p-6">
              <EmptyState
                hint="users"
                label="No se pudo cargar la lista. Verificá tu sesión."
                action={
                  <Button variant="secondary" size="sm" onClick={() => refetch()}>
                    Reintentar
                  </Button>
                }
              />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-6">
              <EmptyState
                hint="users"
                stream={`tenant · query='${query || '*'}' · status=${status} · role=${roleFilter}`}
                label={
                  query || status !== 'todos' || roleFilter !== 'todos'
                    ? 'No coincide ningún usuario con los filtros'
                    : 'El tenant aún no tiene usuarios'
                }
                action={
                  !query && status === 'todos' && roleFilter === 'todos' ? (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => setCreateOpen(true)}
                    >
                      <Plus className="size-3.5" />
                      Crear primer usuario
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH className="w-12"></TH>
                  <TH>Usuario</TH>
                  <TH>Rol</TH>
                  <TH>Parent</TH>
                  <TH align="right">Balance</TH>
                  <TH>Estado</TH>
                  <TH>Último login</TH>
                  <TH align="right">Creado</TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((u, i) => (
                  <TR
                    key={u.id}
                    interactive
                    onClick={() => setSelectedId(u.id)}
                    className="animate-fade-up-staggered"
                    style={{ animationDelay: `${Math.min(i * 30, 600)}ms` }}
                  >
                    <TD className="py-1.5">
                      <Avatar name={u.displayName || u.username} />
                    </TD>
                    <TD>
                      <div className="flex flex-col">
                        <span className="text-[13px] text-[var(--color-fg)]">
                          {u.displayName || u.username}
                        </span>
                        <span className="text-[11px] text-[var(--color-fg-subtle)] font-mono">
                          @{u.username}
                        </span>
                      </div>
                    </TD>
                    <TD>
                      <RolesChips codes={u.roleCodes} />
                    </TD>
                    <TD>
                      {u.parentUsername ? (
                        <span
                          className="text-[11px] font-mono text-[var(--color-fg-muted)]"
                          title="Subordinado de este user"
                        >
                          @{u.parentUsername}
                        </span>
                      ) : (
                        <span className="text-[var(--color-fg-subtle)]">—</span>
                      )}
                    </TD>
                    <TD numeric>
                      {u.walletBalance === null ? (
                        <span className="text-[var(--color-fg-subtle)]">—</span>
                      ) : (
                        <span className="text-[12px] font-mono tabular-nums text-[var(--color-fg)]">
                          {Number(u.walletBalance).toLocaleString()}
                        </span>
                      )}
                    </TD>
                    <TD>
                      <Badge
                        variant={STATUS_VARIANT[u.status] ?? 'neutral'}
                        dot
                      >
                        {u.status}
                      </Badge>
                    </TD>
                    <TD>
                      {u.lastLoginAt ? (
                        <span
                          className="text-[11px] font-mono text-[var(--color-fg-muted)]"
                          title={formatFull(u.lastLoginAt)}
                        >
                          {formatRelative(u.lastLoginAt)}
                        </span>
                      ) : (
                        <span
                          className="text-[11px] text-[var(--color-fg-subtle)] italic"
                          title="Nunca se logueó"
                        >
                          nunca
                        </span>
                      )}
                    </TD>
                    <TD numeric className="text-[var(--color-fg-muted)]">
                      {formatDate(u.createdAt)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
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
      </div>

      <UserDetailDrawer
        userId={selectedId}
        open={!!selectedId}
        onOpenChange={(o) => !o && setSelectedId(null)}
      />

      <CreateUserModal open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Stats strip
// ──────────────────────────────────────────────────────────────────────

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
          <Skeleton
            key={i}
            className="h-16 w-full bg-[var(--color-bg-subtle)]"
          />
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
        hint={
          stats.createdLast7d > 0
            ? `+${stats.createdLast7d} en últimos 7 días`
            : 'Sin altas recientes'
        }
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
      <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)]">
        {label}
      </div>
      <div className="font-display text-2xl tabular-nums tracking-tight text-[var(--color-fg)] mt-0.5">
        {value}
      </div>
      {hint && (
        <div className="text-[10px] text-[var(--color-fg-subtle)] mt-0.5">
          {hint}
        </div>
      )}
    </div>
  );
}

function pct(part: number, total: number): string {
  if (!total) return '0';
  return ((part / total) * 100).toFixed(0);
}

// ──────────────────────────────────────────────────────────────────────
// Roles chips
// ──────────────────────────────────────────────────────────────────────

function RolesChips({ codes }: { codes: string[] }) {
  if (codes.length === 0) {
    return (
      <span className="text-[11px] text-[var(--color-fg-subtle)] italic">
        sin rol
      </span>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {codes.map((c) => (
        <Badge
          key={c}
          variant={ROLE_VARIANT[c] ?? 'neutral'}
          className="text-[10px] uppercase tracking-[0.04em]"
        >
          {ROLE_SHORT_LABEL[c] ?? c}
        </Badge>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <div className="size-8 border border-[var(--color-border-strong)] bg-[var(--color-bg-subtle)] flex items-center justify-center text-[11px] font-mono uppercase shrink-0 text-[var(--color-fg-muted)]">
      {initials || '?'}
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('es-AR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
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

/** "hace X" — formato relativo grueso (no usa Intl.RelativeTimeFormat
 *  para evitar variaciones de plural/género en español). */
function formatRelative(iso: string): string {
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const min = Math.floor(diff / 60_000);
    if (min < 1) return 'ahora';
    if (min < 60) return `hace ${min} min`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `hace ${hr}h`;
    const days = Math.floor(hr / 24);
    if (days < 30) return `hace ${days}d`;
    const months = Math.floor(days / 30);
    if (months < 12) return `hace ${months}mes`;
    const years = Math.floor(days / 365);
    return `hace ${years}a`;
  } catch {
    return iso;
  }
}

function LoadingTable() {
  return (
    <div className="p-4 flex flex-col gap-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-10 w-full bg-[var(--color-bg-subtle)]"
        />
      ))}
    </div>
  );
}

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
          className="px-3 h-7 text-[11px] uppercase tracking-[0.08em] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Anterior
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!hasMore}
          className="px-3 h-7 text-[11px] uppercase tracking-[0.08em] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}
