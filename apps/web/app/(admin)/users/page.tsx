/**
 * /users — lista + create modal + edit drawer.
 *
 * Composición:
 *   - Header con título display + count + acciones (Crear, Refrescar).
 *   - Toolbar con búsqueda + filtros de status.
 *   - Tabla densa con click → drawer detalle.
 *   - Drawer con modo view + modo edit inline.
 *   - Modal de creación con form react-hook-form + Zod.
 */

'use client';

import { Plus, RefreshCw, Search, UserRound } from 'lucide-react';
import { useState } from 'react';
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
import { useUsersList } from '@/lib/hooks/use-users';
import { cn } from '@/lib/cn';

const STATUS_FILTERS = ['todos', 'active', 'banned', 'pending'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  active: 'success',
  banned: 'danger',
  suspended: 'warning',
  pending: 'neutral',
};

const PAGE_SIZE = 50;

export default function UsersPage() {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 300);
  const [status, setStatus] = useState<StatusFilter>('todos');
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // Reset page cuando cambia el search/status (sino quedás en página 3 con
  // un filter que ya no tiene tantas páginas).
  const filters = {
    search: debouncedQuery,
    status: status === 'todos' ? undefined : (status as Exclude<StatusFilter, 'todos'>),
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  };

  const { data, isLoading, isError, refetch, isFetching } = useUsersList(filters);
  const rows = data?.data ?? [];
  const total = data?.total ?? 0;

  return (
    <>
      <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[1600px] mx-auto">
        {/* Header */}
        <header className="flex items-end justify-between gap-6 pb-2">
          <div className="flex flex-col gap-2">
            <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
              <UserRound className="size-3" />
              Operación · Usuarios
            </span>
            <h1 className="font-display text-[2.5rem] leading-none tracking-tight">
              Usuarios del tenant
            </h1>
            <p className="text-sm text-[var(--color-fg-muted)] mt-1">
              {data ? `${rows.length} de ${total} usuarios` : 'Cargando...'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <CsvExportButton
              path="/tenant/users/export"
              filenameHint="users"
              entityLabel="usuarios"
            />
            <Button
              variant="secondary"
              size="md"
              onClick={() => refetch()}
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

        {/* Toolbar: search + filters */}
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[var(--color-fg-subtle)] pointer-events-none" />
            <Input
              placeholder="Buscar por username, nombre o email..."
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-px bg-[var(--color-border)] border border-[var(--color-border)]">
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

        {/* Table */}
        <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
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
                stream={`tenant · query='${query || '*'}' · status=${status}`}
                label={
                  query || status !== 'todos'
                    ? 'No coincide ningún usuario con los filtros'
                    : 'El tenant aún no tiene usuarios'
                }
                action={
                  !query && status === 'todos' ? (
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
                  <TH>Email</TH>
                  <TH>Estado</TH>
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
                      <span className="font-mono text-[12px] text-[var(--color-fg-muted)]">
                        {u.email ?? '—'}
                      </span>
                    </TD>
                    <TD>
                      <Badge
                        variant={STATUS_VARIANT[u.status] ?? 'neutral'}
                        dot
                      >
                        {u.status}
                      </Badge>
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
    <div className="flex items-center justify-end gap-3 text-[11px] text-[var(--color-fg-subtle)]">
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
          ← Prev
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!hasMore}
          className="px-3 h-7 text-[11px] uppercase tracking-[0.08em] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
