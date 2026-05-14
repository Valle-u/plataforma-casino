/**
 * /users — lista de usuarios del tenant + drawer de detalle.
 *
 * Composición:
 *   - Header con título display + count + acciones (search, refresh,
 *     "crear user" — placeholder, sprint próximo).
 *   - Toolbar con búsqueda inline + filtros de status.
 *   - Tabla densa (avatar fallback + username + email + status + fecha).
 *   - Click en row → drawer con detalle (perfil + roles + permisos
 *     efectivos paginados visualmente).
 *   - Empty state si no hay resultados.
 *
 * Filtros: search por username/displayName/email + filtro de status.
 * Todos client-side por ahora (lista actual del tenant es chica).
 */

'use client';

import { Plus, RefreshCw, Search, ShieldCheck, UserRound } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { useUserDetail, useUsersList, type TenantUserRow } from '@/lib/hooks/use-users';
import { cn } from '@/lib/cn';

const STATUS_FILTERS = ['todos', 'active', 'banned', 'pending'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  active: 'success',
  banned: 'danger',
  pending: 'warning',
};

export default function UsersPage() {
  const { data, isLoading, isError, refetch, isFetching } = useUsersList();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('todos');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rows: TenantUserRow[] = useMemo(() => {
    if (!data) return [];
    const lq = query.trim().toLowerCase();
    return data.data.filter((u) => {
      if (status !== 'todos' && u.status !== status) return false;
      if (!lq) return true;
      return (
        u.username.toLowerCase().includes(lq) ||
        u.displayName.toLowerCase().includes(lq) ||
        (u.email ?? '').toLowerCase().includes(lq)
      );
    });
  }, [data, query, status]);

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
              {data
                ? `${rows.length} de ${data.count} usuarios`
                : 'Cargando...'}
            </p>
          </div>
          <div className="flex items-center gap-2">
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
            <Button variant="primary" size="md" disabled title="Disponible en Sprint 3">
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
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-px bg-[var(--color-border)] border border-[var(--color-border)]">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
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
                stream={`tenant:jest · query='${query || '*'}' · status=${status}`}
                label={
                  query || status !== 'todos'
                    ? 'No coincide ningún usuario con los filtros'
                    : 'El tenant aún no tiene usuarios'
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
      </div>

      {/* Detail drawer */}
      <UserDetailDrawer
        userId={selectedId}
        open={!!selectedId}
        onOpenChange={(o) => !o && setSelectedId(null)}
      />
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

interface UserDetailDrawerProps {
  userId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function UserDetailDrawer({ userId, open, onOpenChange }: UserDetailDrawerProps) {
  const { data, isLoading, isError } = useUserDetail(userId);

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={data?.user.displayName ?? data?.user.username ?? 'Cargando…'}
      subtitle={data ? `@${data.user.username}` : userId ? userId.slice(0, 13) + '…' : ''}
      footer={
        <>
          <Button variant="secondary" size="md" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
          <Button variant="primary" size="md" disabled title="Editar disponible en Sprint 3">
            Editar
          </Button>
        </>
      }
    >
      {isLoading && (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-20 w-full bg-[var(--color-bg-subtle)]" />
          <Skeleton className="h-32 w-full bg-[var(--color-bg-subtle)]" />
          <Skeleton className="h-48 w-full bg-[var(--color-bg-subtle)]" />
        </div>
      )}
      {isError && (
        <EmptyState
          hint="user_detail"
          label="No se pudo cargar el detalle del usuario."
        />
      )}
      {data && (
        <div className="flex flex-col gap-6">
          {/* Perfil */}
          <section className="flex flex-col gap-3">
            <SectionHeader label="Perfil" />
            <DetailRow label="Email" value={data.user.email ?? '—'} mono />
            <DetailRow
              label="Teléfono"
              value={data.user.phone ?? '—'}
              mono
            />
            <DetailRow
              label="Estado"
              valueNode={
                <Badge
                  variant={STATUS_VARIANT[data.user.status] ?? 'neutral'}
                  dot
                >
                  {data.user.status}
                </Badge>
              }
            />
            <DetailRow
              label="2FA"
              valueNode={
                data.user.twoFaEnabled ? (
                  <Badge variant="success" dot>
                    Activo
                  </Badge>
                ) : (
                  <Badge variant="neutral">Inactivo</Badge>
                )
              }
            />
            <DetailRow
              label="Creado"
              value={formatDate(data.user.createdAt)}
              mono
            />
          </section>

          {/* Roles */}
          <section className="flex flex-col gap-3">
            <SectionHeader label={`Roles (${data.roles.length})`} />
            <div className="flex flex-wrap gap-1.5">
              {data.roles.length === 0 ? (
                <span className="text-[12px] text-[var(--color-fg-subtle)] italic">
                  Sin roles asignados
                </span>
              ) : (
                data.roles.map((r) => (
                  <Badge
                    key={r.code}
                    variant={r.isSystem ? 'danger' : 'neutral'}
                  >
                    {r.code}
                  </Badge>
                ))
              )}
            </div>
          </section>

          {/* Permisos efectivos */}
          <section className="flex flex-col gap-3">
            <SectionHeader
              label={`Permisos efectivos (${data.effectivePermissions.length})`}
              icon={<ShieldCheck className="size-3 text-[var(--color-accent)]" />}
            />
            <div className="bg-[var(--color-bg)] border border-[var(--color-border)] max-h-[280px] overflow-y-auto">
              {data.effectivePermissions.length === 0 ? (
                <div className="p-3 text-[12px] text-[var(--color-fg-subtle)] italic">
                  Sin permisos
                </div>
              ) : (
                <ul className="flex flex-col">
                  {data.effectivePermissions.map((perm) => (
                    <li
                      key={perm}
                      className="px-3 py-1.5 text-[12px] font-mono text-[var(--color-fg-muted)] border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-bg-subtle)] transition-colors"
                    >
                      {perm}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      )}
    </Drawer>
  );
}

function SectionHeader({
  label,
  icon,
}: {
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 pb-2 border-b border-[var(--color-border)]">
      {icon}
      <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium">
        {label}
      </span>
    </div>
  );
}

function DetailRow({
  label,
  value,
  valueNode,
  mono,
}: {
  label: string;
  value?: string;
  valueNode?: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-center gap-3">
      <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)]">
        {label}
      </span>
      {valueNode ?? (
        <span
          className={cn(
            'text-[13px] text-[var(--color-fg)]',
            mono && 'font-mono',
          )}
        >
          {value}
        </span>
      )}
    </div>
  );
}
