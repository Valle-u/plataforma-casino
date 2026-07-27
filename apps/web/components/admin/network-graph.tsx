'use client';

import { useMemo } from 'react';
import { User, Shield, Crown, Briefcase, CreditCard, Store, ChevronRight } from 'lucide-react';
import type { NetworkNode } from '@/lib/hooks/use-network-tree';
import { cn } from '@/lib/cn';

const ROLE_STYLES: Record<string, {
  icon: typeof User;
  iconColor: string;
  roleColor: string;
  nodeBorder: string;
  nodeBg: string;
}> = {
  admin_tenant:    { icon: Crown, iconColor: '#f59e0b', roleColor: '#f59e0b', nodeBorder: 'rgba(245,158,11,0.3)',  nodeBg: '#1c1608' },
  socio:           { icon: Store, iconColor: '#22c55e', roleColor: '#22c55e', nodeBorder: 'rgba(34,197,94,0.3)',   nodeBg: '#0c1f14' },
  distribuidor:    { icon: Briefcase, iconColor: '#06b6d4', roleColor: '#06b6d4', nodeBorder: 'rgba(6,182,212,0.3)',   nodeBg: '#0a1822' },
  cajero:          { icon: CreditCard, iconColor: '#d946ef', roleColor: '#d946ef', nodeBorder: 'rgba(217,70,239,0.3)',  nodeBg: '#1a0c22' },
  empleado:        { icon: Shield, iconColor: '#8b5cf6', roleColor: '#8b5cf6', nodeBorder: 'rgba(139,92,246,0.3)',  nodeBg: '#13102a' },
  usuario_final:   { icon: User, iconColor: '#a3a3a3', roleColor: '#a3a3a3', nodeBorder: 'rgba(163,163,163,0.2)',  nodeBg: '#141414' },
};

const DEFAULT_STYLE: typeof ROLE_STYLES[string] = ROLE_STYLES.usuario_final!;

function getStyle(roleCode: string): typeof ROLE_STYLES[string] {
  return ROLE_STYLES[roleCode] ?? DEFAULT_STYLE;
}

// ── Single node card ──────────────────────────────────────────────────
function NodeCard({ node }: { node: NetworkNode }) {
  const s = getStyle(node.primaryRole);
  const Icon = s.icon;
  const name = node.displayName || node.username;
  const roleLabel = node.roles[0]?.name ?? node.primaryRole.replace(/_/g, ' ');

  return (
    <div
      className="flex items-center gap-3 rounded-xl px-4 py-3 shrink-0"
      style={{
        background: s.nodeBg,
        border: `1px solid ${s.nodeBorder}`,
        minWidth: 200,
      }}
    >
      <div
        className="grid size-10 shrink-0 place-items-center rounded-lg"
        style={{ background: `${s.iconColor}15` }}
      >
        <Icon size={18} style={{ color: s.iconColor }} />
      </div>
      <div className="flex flex-col min-w-0">
        <span className="text-[13px] font-semibold text-white truncate">{name}</span>
        <span className="text-[11px] font-medium truncate" style={{ color: s.roleColor }}>
          {roleLabel}
        </span>
      </div>
    </div>
  );
}

// ── Recursive tree node ───────────────────────────────────────────────
interface TreeNodeProps {
  node: NetworkNode;
  childMap: Map<string, NetworkNode[]>;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  isRoot?: boolean;
}

function TreeNode({ node, childMap, expandedIds, onToggle, isRoot }: TreeNodeProps) {
  const children = childMap.get(node.id) ?? [];
  const hasChildren = children.length > 0;
  const isExpanded = expandedIds.has(node.id);
  const s = getStyle(node.primaryRole);

  return (
    <div className={cn('flex flex-col', !isRoot && 'ml-8')}>
      {/* Node + toggle row */}
      <div className="flex items-center gap-2">
        {/* Vertical bracket line from parent */}
        {!isRoot && (
          <div
            className="w-px self-stretch shrink-0"
            style={{ background: `${s.roleColor}30` }}
          />
        )}

        {/* Horizontal connector */}
        {!isRoot && (
          <div
            className="h-px w-4 shrink-0"
            style={{ background: `${s.roleColor}30` }}
          />
        )}

        {/* The card */}
        <NodeCard node={node} />

        {/* Toggle button */}
        {hasChildren && (
          <button
            type="button"
            onClick={() => onToggle(node.id)}
            className="flex items-center gap-1 shrink-0 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors hover:bg-white/5"
            style={{
              borderColor: `${s.roleColor}30`,
              color: s.roleColor,
            }}
          >
            <ChevronRight
              size={12}
              className={cn('transition-transform duration-200', isExpanded && 'rotate-90')}
            />
            <span className="tabular-nums">{children.length}</span>
          </button>
        )}
      </div>

      {/* Children */}
      {isExpanded && hasChildren && (
        <div className="flex flex-col relative ml-5">
          {/* Vertical line connecting children */}
          <div
            className="absolute left-0 top-0 bottom-3 w-px"
            style={{ background: `${s.roleColor}20` }}
          />

          {children.map((child) => (
            <div key={child.id} className="relative">
              {/* Horizontal tick */}
              <div
                className="absolute left-0 top-5 h-px w-3"
                style={{ background: `${getStyle(child.primaryRole).roleColor}30` }}
              />
              <TreeNode
                node={child}
                childMap={childMap}
                expandedIds={expandedIds}
                onToggle={onToggle}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────
interface NetworkGraphProps {
  nodes: NetworkNode[];
  focusUserId?: string | null;
  onSelectUser?: (id: string | null) => void;
  expandedIds: Set<string>;
  onToggleNode: (id: string) => void;
}

export function NetworkGraph({ nodes, expandedIds, onToggleNode }: NetworkGraphProps) {
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

  const rootNodes = useMemo(() => nodes.filter((n) => !n.parentUserId), [nodes]);

  return (
    <div className="h-full overflow-auto p-8">
      <div className="flex flex-col gap-8">
        {rootNodes.map((root) => (
          <TreeNode
            key={root.id}
            node={root}
            childMap={childMap}
            expandedIds={expandedIds}
            onToggle={onToggleNode}
            isRoot
          />
        ))}
      </div>
    </div>
  );
}
