'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  Network,
  Users,
  RefreshCw,
  Search,
  X,
  Crown,
  Shield,
  Briefcase,
  CreditCard,
  Store,
  User,
  ChevronDown,
  ChevronRight,
  Circle,
  Minimize2,
  Maximize2,
} from 'lucide-react';
import { useNetworkTree, type NetworkNode } from '@/lib/hooks/use-network-tree';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';

const ROLES: Record<string, { icon: typeof User; color: string; bg: string; border: string; label: string }> = {
  admin_tenant:  { icon: Crown,     color: '#f59e0b', bg: '#1c1608', border: '#f59e0b20', label: 'Admin' },
  socio:         { icon: Store,     color: '#22c55e', bg: '#0c1f14', border: '#22c55e20', label: 'Socio' },
  distribuidor:  { icon: Briefcase, color: '#06b6d4', bg: '#0a1822', border: '#06b6d420', label: 'Distribuidor' },
  cajero:        { icon: CreditCard, color: '#d946ef', bg: '#1a0c22', border: '#d946ef20', label: 'Cajero' },
  empleado:      { icon: Shield,    color: '#8b5cf6', bg: '#13102a', border: '#8b5cf620', label: 'Empleado' },
  usuario_final: { icon: User,      color: '#a3a3a3', bg: '#141414', border: '#a3a3a315', label: 'Jugador' },
};

type RoleEntry = { icon: typeof User; color: string; bg: string; border: string; label: string };

const DEFAULT_ROLE: RoleEntry = { icon: User, color: '#a3a3a3', bg: '#141414', border: '#a3a3a315', label: 'Jugador' };

function getRole(code: string): RoleEntry {
  return ROLES[code] ?? DEFAULT_ROLE;
}

function NodeCard({ node, childCount, isExpanded, onToggle }: {
  node: NetworkNode;
  childCount: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const r = getRole(node.primaryRole);
  const Icon = r.icon;
  const name = node.displayName || node.username;
  const roleLabel = node.roles[0]?.name ?? r.label;
  const isActive = node.status === 'active';

  return (
    <div
      className="group relative flex items-center gap-3 rounded-xl px-4 py-3 transition-all duration-200"
      style={{
        background: r.bg,
        border: `1px solid ${r.border}`,
        minWidth: 220,
        maxWidth: 280,
      }}
    >
      <div
        className="grid size-9 shrink-0 place-items-center rounded-lg"
        style={{ background: `${r.color}12` }}
      >
        <Icon size={16} style={{ color: r.color }} />
      </div>

      <div className="flex flex-col min-w-0 flex-1 gap-0.5">
        <span className="text-[12px] font-semibold text-white truncate leading-tight">{name}</span>
        <span className="text-[10px] font-medium truncate leading-tight" style={{ color: r.color }}>
          {roleLabel}
        </span>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <Circle
          size={5}
          className={cn('fill-current shrink-0', isActive ? 'text-emerald-400' : 'text-neutral-500')}
        />

        {childCount > 0 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            className="flex items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-[9px] font-semibold transition-colors hover:bg-white/5"
            style={{ borderColor: `${r.color}30`, color: r.color }}
          >
            {isExpanded ? <ChevronDown size={8} /> : <ChevronRight size={8} />}
            {childCount}
          </button>
        )}
      </div>
    </div>
  );
}

function TreeNode({
  node,
  childMap,
  expandedIds,
  onToggle,
}: {
  node: NetworkNode;
  childMap: Map<string, NetworkNode[]>;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  const children = childMap.get(node.id) ?? [];
  const hasChildren = children.length > 0;
  const isExpanded = expandedIds.has(node.id);
  const r = getRole(node.primaryRole);

  return (
    <div className="flex flex-col items-center">
      <NodeCard
        node={node}
        childCount={children.length}
        isExpanded={isExpanded}
        onToggle={() => onToggle(node.id)}
      />

      {isExpanded && hasChildren && (
        <>
          <div className="relative flex flex-col items-center">
            <div className="w-px h-5" style={{ background: `${r.color}25` }} />
          </div>

          <div className="flex items-start gap-0">
            {children.length > 1 && (
              <div
                className="h-px shrink-0 mt-0"
                style={{
                  background: `${r.color}20`,
                  width: `${(children.length - 1) * 260}px`,
                  alignSelf: 'flex-start',
                }}
              />
            )}
          </div>

          <div className="flex flex-wrap justify-center gap-x-4 gap-y-0">
            {children.map((child) => (
              <div key={child.id} className="flex flex-col items-center">
                <TreeNode
                  node={child}
                  childMap={childMap}
                  expandedIds={expandedIds}
                  onToggle={onToggle}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function StatsBar({ nodes }: { nodes: NetworkNode[] }) {
  const stats = useMemo(() => {
    const byRole = new Map<string, number>();
    let active = 0;
    for (const n of nodes) {
      byRole.set(n.primaryRole, (byRole.get(n.primaryRole) ?? 0) + 1);
      if (n.status === 'active') active++;
    }
    return { total: nodes.length, active, byRole };
  }, [nodes]);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-2.5 py-0.5 text-[10px] tabular-nums text-[var(--color-fg-muted)]">
        <Users size={9} />
        {stats.total}
      </span>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] tabular-nums text-emerald-400">
        {stats.active} activos
      </span>
      {Array.from(stats.byRole.entries()).map(([role, count]) => {
        const r = getRole(role);
        return (
          <span
            key={role}
            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] tabular-nums"
            style={{ borderColor: `${r.color}25`, color: r.color, background: `${r.color}10` }}
          >
            <r.icon size={8} />
            {count}
          </span>
        );
      })}
    </div>
  );
}

export default function NetworkPage() {
  const { data, isLoading, refetch, isFetching } = useNetworkTree();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const nodes = data?.nodes ?? [];

  const childMap = useMemo(() => {
    const map = new Map<string, NetworkNode[]>();
    for (const n of nodes) {
      if (n.parentUserId) {
        const list = map.get(n.parentUserId) ?? [];
        list.push(n);
        map.set(n.parentUserId, list);
      }
    }
    return map;
  }, [nodes]);

  const allRoots = useMemo(() => nodes.filter((n) => !n.parentUserId), [nodes]);

  const filteredRoots = useMemo(() => {
    let result = allRoots;
    if (roleFilter !== 'all') {
      const matchesFilter = (n: NetworkNode): boolean => {
        if (n.primaryRole === roleFilter) return true;
        const children = childMap.get(n.id) ?? [];
        return children.some(matchesFilter);
      };
      result = result.filter(matchesFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchesSearch = (n: NetworkNode): boolean => {
        if (n.displayName.toLowerCase().includes(q) || n.username.toLowerCase().includes(q)) return true;
        const children = childMap.get(n.id) ?? [];
        return children.some(matchesSearch);
      };
      result = result.filter(matchesSearch);
    }
    return result;
  }, [allRoots, roleFilter, search, childMap]);

  const allRoles = useMemo(() => {
    const set = new Set(nodes.map((n) => n.primaryRole));
    return Array.from(set).sort();
  }, [nodes]);

  const initializedRef = useRef(false);
  useEffect(() => {
    if (allRoots.length > 0 && !initializedRef.current) {
      initializedRef.current = true;
      setExpandedIds(new Set(allRoots.map((r) => r.id)));
    }
  }, [allRoots]);

  const handleToggle = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleExpandAll = useCallback(() => {
    const allIds = new Set(nodes.map((n) => n.id));
    setExpandedIds(allIds);
  }, [nodes]);

  const handleCollapseAll = useCallback(() => {
    setExpandedIds(new Set());
  }, []);

  return (
    <div className="px-4 py-4 sm:px-6 sm:py-5 lg:px-8 lg:py-6 flex flex-col gap-5 max-w-[1600px] mx-auto min-h-screen">
      {/* Header */}
      <header className="shrink-0 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-subtle)] font-medium">
            <Network className="size-3" />
            Sistema
          </span>
          <div className="flex items-center gap-3 mt-1">
            <h1 className="font-display text-3xl lg:text-[2.5rem] leading-none tracking-tight">
              Red
            </h1>
            {data && <StatsBar nodes={nodes} />}
          </div>
        </div>
        <Button
          variant="outline-accent"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
          Actualizar
        </Button>
      </header>

      {/* Toolbar */}
      <div className="shrink-0 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-subtle)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre o usuario..."
            className="w-full h-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] pl-9 pr-9 text-[12px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] outline-none focus:border-[var(--color-accent-border)]"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
            >
              <X size={12} />
            </button>
          )}
        </div>

        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="h-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 text-[12px] text-[var(--color-fg)] outline-none focus:border-[var(--color-accent-border)]"
        >
          <option value="all">Todos los roles</option>
          {allRoles.map((r) => (
            <option key={r} value={r}>{getRole(r).label}</option>
          ))}
        </select>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleExpandAll}
            className="h-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 text-[11px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] transition-colors inline-flex items-center gap-1.5"
          >
            <Maximize2 size={10} />
            Expandir
          </button>
          <button
            type="button"
            onClick={handleCollapseAll}
            className="h-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 text-[11px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] transition-colors inline-flex items-center gap-1.5"
          >
            <Minimize2 size={10} />
            Colapsar
          </button>
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-8 overflow-auto">
        {isLoading ? (
          <div className="flex flex-col gap-4 max-w-md">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-xl bg-[var(--color-bg-subtle)]" />
            ))}
          </div>
        ) : filteredRoots.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex flex-col items-center gap-3 text-center">
              <Network size={40} className="text-[var(--color-fg-subtle)]" />
              <span className="text-[13px] text-[var(--color-fg-muted)]">
                {search || roleFilter !== 'all' ? 'No se encontraron usuarios' : 'No hay usuarios en la red'}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap justify-center gap-x-12 gap-y-8">
            {filteredRoots.map((root) => (
              <TreeNode
                key={root.id}
                node={root}
                childMap={childMap}
                expandedIds={expandedIds}
                onToggle={handleToggle}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
