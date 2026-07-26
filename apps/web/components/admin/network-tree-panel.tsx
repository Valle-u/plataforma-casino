/**
 * NetworkTreePanel — left sidebar showing the hierarchy tree as a
 * collapsible list. Used alongside the React Flow graph.
 */

'use client';

import { useState, useMemo } from 'react';
import {
  ChevronRight,
  Crown,
  User,
  Shield,
  Briefcase,
  CreditCard,
  Store,
  Search,
  X,
} from 'lucide-react';
import type { NetworkNode } from '@/lib/hooks/use-network-tree';
import { cn } from '@/lib/cn';

const ROLE_ICON: Record<string, typeof User> = {
  admin_tenant: Crown,
  socio: Store,
  distribuidor: Briefcase,
  cajero: CreditCard,
  empleado: Shield,
  usuario_final: User,
};

const ROLE_BADGE_COLOR: Record<string, string> = {
  admin_tenant: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  socio: 'bg-green-500/20 text-green-400 border-green-500/30',
  distribuidor: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  cajero: 'bg-fuchsia-500/20 text-fuchsia-400 border-fuchsia-500/30',
  empleado: 'bg-violet-500/20 text-violet-400 border-violet-500/30',
  usuario_final: 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30',
};

interface TreeItemProps {
  node: NetworkNode;
  childMap: Map<string, NetworkNode[]>;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  selectedId: string | null;
  depth?: number;
}

function TreeItem({ node, childMap, expandedIds, onToggle, onSelect, selectedId, depth = 0 }: TreeItemProps) {
  const children = childMap.get(node.id) ?? [];
  const hasChildren = children.length > 0;
  const isExpanded = expandedIds.has(node.id);
  const isSelected = selectedId === node.id;
  const Icon = ROLE_ICON[node.primaryRole] ?? User;
  const badgeColor = ROLE_BADGE_COLOR[node.primaryRole] ?? ROLE_BADGE_COLOR.usuario_final;
  const roleLabel = node.roles[0]?.name ?? node.primaryRole;

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] cursor-pointer transition-colors group',
          isSelected
            ? 'bg-[var(--color-accent-subtle)] text-[var(--color-fg)]'
            : 'text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-fg)]',
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => onSelect(node.id)}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggle(node.id); }}
            className="shrink-0 grid size-4 place-items-center rounded hover:bg-[var(--color-bg-subtle)]"
          >
            <ChevronRight
              size={10}
              className={cn('transition-transform duration-150', isExpanded && 'rotate-90')}
            />
          </button>
        ) : (
          <span className="shrink-0 size-4" />
        )}

        <Icon size={12} className="shrink-0 text-[var(--color-fg-subtle)]" />

        <span className="truncate flex-1 font-medium">{node.displayName || node.username}</span>

        {hasChildren && (
          <span className="shrink-0 text-[9px] tabular-nums text-[var(--color-fg-subtle)]">
            {children.length}
          </span>
        )}

        <span className={cn('shrink-0 rounded-full border px-1.5 py-0.5 text-[8px] font-medium', badgeColor)}>
          {roleLabel}
        </span>
      </div>

      {isExpanded && hasChildren && (
        <div>
          {children.map((child) => (
            <TreeItem
              key={child.id}
              node={child}
              childMap={childMap}
              expandedIds={expandedIds}
              onToggle={onToggle}
              onSelect={onSelect}
              selectedId={selectedId}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface NetworkTreePanelProps {
  nodes: NetworkNode[];
  onSelectUser: (id: string | null) => void;
  selectedUserId: string | null;
}

export function NetworkTreePanel({ nodes, onSelectUser, selectedUserId }: NetworkTreePanelProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    const roots = nodes.filter((n) => !n.parentUserId);
    return new Set(roots.map((r) => r.id));
  });
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');

  const toggleNode = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Build child map
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

  // Root nodes
  const rootNodes = useMemo(() => {
    let filtered = nodes.filter((n) => !n.parentUserId);
    if (roleFilter !== 'all') {
      filtered = filtered.filter((n) => n.primaryRole === roleFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = nodes.filter(
        (n) =>
          n.displayName.toLowerCase().includes(q) ||
          n.username.toLowerCase().includes(q),
      );
    }
    return filtered;
  }, [nodes, roleFilter, search]);

  const allRoles = useMemo(() => {
    const set = new Set(nodes.map((n) => n.primaryRole));
    return Array.from(set).sort();
  }, [nodes]);

  const visibleCount = useMemo(() => {
    if (search.trim()) {
      const q = search.toLowerCase();
      return nodes.filter(
        (n) => n.displayName.toLowerCase().includes(q) || n.username.toLowerCase().includes(q),
      ).length;
    }
    return nodes.length;
  }, [nodes, search]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[13px] font-semibold text-[var(--color-fg)]">Estructura</h3>
          <span className="text-[10px] tabular-nums text-[var(--color-fg-subtle)] bg-[var(--color-bg-subtle)] rounded-full px-2 py-0.5">
            {visibleCount} users
          </span>
        </div>

        {/* Search */}
        <div className="relative mb-2">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-fg-subtle)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre o usuario..."
            className="w-full h-8 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-subtle)] pl-7 pr-7 text-[11px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] outline-none focus:border-[var(--color-accent-border)]"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Role filter */}
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="w-full h-8 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-2 text-[11px] text-[var(--color-fg)] outline-none focus:border-[var(--color-accent-border)]"
        >
          <option value="all">Todos los roles</option>
          {allRoles.map((r) => (
            <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto px-1 py-2">
        {rootNodes.map((root) => (
          <TreeItem
            key={root.id}
            node={root}
            childMap={childMap}
            expandedIds={expandedIds}
            onToggle={toggleNode}
            onSelect={onSelectUser}
            selectedId={selectedUserId}
          />
        ))}
        {rootNodes.length === 0 && (
          <div className="px-4 py-8 text-center text-[11px] text-[var(--color-fg-subtle)]">
            No se encontraron usuarios
          </div>
        )}
      </div>
    </div>
  );
}
