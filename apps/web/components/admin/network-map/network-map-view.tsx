'use client';

/**
 * NetworkMapView — vista del Mapa de red (sección "Red"). Mapa de nodos
 * interactivo con React Flow: layout horizontal automático, arrastrar+guardar,
 * colapsar, jugadores → lista, búsqueda (filtra a la rama), filtros
 * (rol/estado/independencia/rama), y panel lateral con acciones + reasignar.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useDebouncedValue } from '@/lib/hooks/use-debounced-value';
import {
  Network,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
  RotateCcw,
  Minimize2,
} from 'lucide-react';
import { useNetworkTree } from '@/lib/hooks/use-network-tree';
import { NetworkMap } from '@/components/admin/network-map/network-map';
import {
  ALL_FILTER_ROLES,
  ALL_FILTER_STATUSES,
  buildGraph,
  defaultFilters,
  playersOf,
  type NetworkFilters,
  type PlayerRow,
} from '@/components/admin/network-map/layout';
import type { NetworkMapHandlers } from '@/components/admin/network-map/network-map-context';
import { NodePanel } from '@/components/admin/network-map/node-panel';
import { roleStyle } from '@/components/admin/network-map/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Drawer } from '@/components/ui/drawer';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/cn';

const ROLE_LABEL: Record<string, string> = {
  socio: 'Socios',
  distribuidor: 'Distribuidores',
  cajero: 'Cajeros',
  jugadores: 'Jugadores',
};
const STATUS_LABEL: Record<string, string> = {
  active: 'Activos',
  inactive: 'Inactivos',
  suspended: 'Suspendidos',
  banned: 'Bloqueados',
};

export default function NetworkMapView() {
  const { data, isLoading, isError, refetch, isFetching } = useNetworkTree();

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<NetworkFilters>(defaultFilters);

  // Al abrir: solo se ven los hijos directos de "La Casa". El resto arranca
  // colapsado y se va abriendo a mano. Colapsar TODOS los nodos reales hace
  // que solo la raíz (que no está en la lista) muestre su primer nivel.
  const allIds = useMemo(
    () => (data ? data.nodes.filter((n) => !n.isSystem).map((n) => n.id) : []),
    [data],
  );
  const initedRef = useRef(false);
  useEffect(() => {
    if (!initedRef.current && data) {
      initedRef.current = true;
      setCollapsed(new Set(allIds));
    }
  }, [data, allIds]);
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebouncedValue(searchInput, 250);
  const [showFilters, setShowFilters] = useState(false);
  const [resetToken, setResetToken] = useState(0);
  const [playersPanel, setPlayersPanel] = useState<{
    parentUserId: string;
    parentLabel: string;
  } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedNode = useMemo(
    () => data?.nodes.find((n) => n.id === selectedId) ?? null,
    [data, selectedId],
  );

  const graph = useMemo(
    () =>
      data
        ? buildGraph(data.nodes, { collapsed, filters })
        : { rfNodes: [], rfEdges: [] },
    [data, collapsed, filters],
  );

  const handlers: NetworkMapHandlers = useMemo(
    () => ({
      toggleCollapse: (id) =>
        setCollapsed((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
      openPlayers: (parentUserId, parentLabel) =>
        setPlayersPanel({ parentUserId, parentLabel }),
    }),
    [],
  );

  // opciones de "aislar una rama": socios y admins (cabezas de rama)
  const branchOptions = useMemo(() => {
    if (!data) return [];
    return data.nodes
      .filter(
        (n) =>
          !n.isSystem &&
          (n.primaryRole === 'socio' || n.primaryRole === 'admin_tenant'),
      )
      .map((n) => ({
        id: n.id,
        label: `${n.primaryRole === 'socio' ? 'Socio' : 'Admin'} · ${n.displayName || n.username}`,
      }));
  }, [data]);

  const filtersActive =
    filters.search.trim() !== '' ||
    filters.roles.size !== ALL_FILTER_ROLES.length ||
    filters.statuses.size !== ALL_FILTER_STATUSES.length ||
    filters.independence !== 'all' ||
    filters.branchRootId !== null;

  const patch = useCallback((p: Partial<NetworkFilters>) => {
    setFilters((f) => ({ ...f, ...p }));
  }, []);

  // La búsqueda se aplica con debounce para no recalcular el mapa en cada tecla.
  useEffect(() => {
    patch({ search: debouncedSearch });
  }, [debouncedSearch, patch]);

  const toggleSet = (set: Set<string>, key: string): Set<string> => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };

  return (
    <div className="flex flex-col gap-3 h-[calc(100dvh-7.5rem)]">
      {/* Header */}
      <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
            <Network className="size-3" />
            Sistema · Red
          </span>
          <h1 className="font-display text-2xl lg:text-[2rem] leading-none tracking-tight">
            Mapa de red
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[var(--color-fg-subtle)] pointer-events-none" />
            <Input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar usuario…"
              className="pl-9 w-full sm:w-56 h-9"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <Button
            variant={showFilters || filtersActive ? 'primary' : 'secondary'}
            size="md"
            onClick={() => setShowFilters((v) => !v)}
          >
            <SlidersHorizontal className="size-3.5" />
            Filtros
            {filtersActive && <span className="size-1.5 rounded-full bg-current" />}
          </Button>
          <Button
            variant="secondary"
            size="md"
            onClick={() => setCollapsed(new Set(allIds))}
            title="Volver a ver solo los hijos directos"
          >
            <Minimize2 className="size-3.5" />
            Colapsar todo
          </Button>
          <Button
            variant="secondary"
            size="md"
            onClick={() => setResetToken((t) => t + 1)}
            title="Volver al orden automático"
          >
            <RotateCcw className="size-3.5" />
            Reordenar
          </Button>
          <Button
            variant="secondary"
            size="md"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={cn('size-3.5', isFetching && 'animate-spin')} />
            Actualizar
          </Button>
        </div>
      </header>

      {/* Barra de filtros */}
      {showFilters && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 border border-[var(--color-border)] bg-[var(--color-bg-elevated)] rounded-lg">
          <FilterGroup label="Roles">
            {ALL_FILTER_ROLES.map((r) => (
              <Pill
                key={r}
                active={filters.roles.has(r)}
                color={r !== 'jugadores' ? roleStyle(r).color : '#64748B'}
                onClick={() => patch({ roles: toggleSet(filters.roles, r) })}
              >
                {ROLE_LABEL[r]}
              </Pill>
            ))}
          </FilterGroup>

          <FilterGroup label="Estado">
            {ALL_FILTER_STATUSES.map((s) => (
              <Pill
                key={s}
                active={filters.statuses.has(s)}
                onClick={() => patch({ statuses: toggleSet(filters.statuses, s) })}
              >
                {STATUS_LABEL[s]}
              </Pill>
            ))}
          </FilterGroup>

          <FilterGroup label="Tipo de red">
            {(['all', 'independent', 'dependent'] as const).map((v) => (
              <Pill
                key={v}
                active={filters.independence === v}
                onClick={() => patch({ independence: v })}
              >
                {v === 'all' ? 'Todas' : v === 'independent' ? 'Independientes' : 'Dependientes'}
              </Pill>
            ))}
          </FilterGroup>

          <FilterGroup label="Rama">
            <select
              value={filters.branchRootId ?? ''}
              onChange={(e) => patch({ branchRootId: e.target.value || null })}
              className="h-8 px-2 text-[12px] bg-[var(--color-bg-subtle)] border border-[var(--color-border)] text-[var(--color-fg)] rounded"
            >
              <option value="">Toda la red</option>
              {branchOptions.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </FilterGroup>

          {filtersActive && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFilters(defaultFilters());
                setSearchInput('');
              }}
            >
              <X className="size-3.5" />
              Limpiar
            </Button>
          )}
        </div>
      )}

      {/* Canvas */}
      <div className="flex-1 min-h-0 border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-bg)]">
        {isLoading ? (
          <div className="p-6 grid grid-cols-3 gap-4">
            {Array.from({ length: 9 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full bg-[var(--color-bg-subtle)]" />
            ))}
          </div>
        ) : isError ? (
          <div className="p-8">
            <EmptyState
              hint="network"
              label="No se pudo cargar la red."
              action={
                <Button variant="secondary" size="sm" onClick={() => void refetch()}>
                  Reintentar
                </Button>
              }
            />
          </div>
        ) : graph.rfNodes.length <= 1 ? (
          <div className="p-8">
            <EmptyState hint="network" label="No hay red que mostrar con estos filtros." />
          </div>
        ) : (
          <NetworkMap
            nodes={graph.rfNodes}
            edges={graph.rfEdges}
            handlers={handlers}
            resetToken={resetToken}
            onSelectUser={setSelectedId}
          />
        )}
      </div>

      {/* Panel de detalle del nodo */}
      <NodePanel
        node={selectedNode}
        onClose={() => setSelectedId(null)}
        onChanged={() => void refetch()}
      />

      {/* Panel de jugadores */}
      <PlayersDrawer
        panel={playersPanel}
        players={
          data && playersPanel
            ? playersOf(data.nodes, playersPanel.parentUserId)
            : []
        }
        onClose={() => setPlayersPanel(null)}
      />
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)] font-medium">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

function Pill({
  active,
  color,
  onClick,
  children,
}: {
  active: boolean;
  color?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 h-7 text-[11px] rounded-full border transition-colors',
        active
          ? 'bg-[var(--color-bg-subtle)] border-[var(--color-border-strong)] text-[var(--color-fg)]'
          : 'bg-transparent border-[var(--color-border)] text-[var(--color-fg-subtle)] opacity-60',
      )}
    >
      {color && (
        <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
      )}
      {children}
    </button>
  );
}

function PlayersDrawer({
  panel,
  players,
  onClose,
}: {
  panel: { parentUserId: string; parentLabel: string } | null;
  players: PlayerRow[];
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return players;
    return players.filter(
      (p) =>
        p.displayName.toLowerCase().includes(s) ||
        p.username.toLowerCase().includes(s),
    );
  }, [players, q]);

  return (
    <Drawer
      open={!!panel}
      onOpenChange={(o) => !o && onClose()}
      title={panel ? `Jugadores de ${panel.parentLabel}` : 'Jugadores'}
      subtitle={`${players.length} en total`}
    >
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[var(--color-fg-subtle)] pointer-events-none" />
          <Input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar jugador…"
            className="pl-9"
          />
        </div>
        <div className="flex flex-col divide-y divide-[var(--color-border)]">
          {filtered.length === 0 ? (
            <span className="text-[12px] text-[var(--color-fg-subtle)] italic py-3">
              Sin jugadores.
            </span>
          ) : (
            filtered.map((p) => (
              <Link
                key={p.id}
                href={`/users/${p.id}`}
                className="flex items-center justify-between gap-3 py-2.5 hover:bg-[var(--color-bg-subtle)] px-2 -mx-2 rounded transition-colors"
              >
                <div className="flex flex-col min-w-0">
                  <span className="text-[13px] text-[var(--color-fg)] truncate">
                    {p.displayName}
                  </span>
                  <span className="text-[11px] text-[var(--color-fg-subtle)] font-mono truncate">
                    @{p.username}
                  </span>
                </div>
                <span
                  className={cn(
                    'text-[10px] uppercase tracking-[0.08em] px-1.5 py-0.5 rounded shrink-0',
                    p.status === 'active'
                      ? 'text-[var(--color-success)]'
                      : 'text-[var(--color-fg-subtle)]',
                  )}
                >
                  {p.status}
                </span>
              </Link>
            ))
          )}
        </div>
      </div>
    </Drawer>
  );
}
