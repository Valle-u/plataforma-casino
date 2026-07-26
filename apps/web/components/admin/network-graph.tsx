/**
 * NetworkGraph — interactive React Flow graph for the admin network map.
 *
 * Features:
 *   - Custom node styling per role (neon palette)
 *   - Independent sub-network nodes have distinct background
 *   - Expand/collapse button on nodes with children
 *   - Double-click navigates to user profile
 *   - Minimap + controls (zoom in/out/fit)
 */

'use client';

import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  Handle,
  Position,
  MarkerType,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, User, Shield, Crown, Briefcase, CreditCard, Store } from 'lucide-react';
import type { NetworkNode } from '@/lib/hooks/use-network-tree';
import { cn } from '@/lib/cn';

// ── Role color mapping (neon palette) ──────────────────────────────────
const ROLE_COLORS: Record<string, { bg: string; border: string; text: string; glow: string; icon: typeof User }> = {
  admin_tenant:    { bg: '#2a1f04', border: '#f59e0b', text: '#fbbf24', glow: 'rgba(245,158,11,0.3)',  icon: Crown },
  socio:           { bg: '#0a2818', border: '#22c55e', text: '#4ade80', glow: 'rgba(34,197,94,0.3)',   icon: Store },
  distribuidor:    { bg: '#0a1a2e', border: '#06b6d4', text: '#22d3ee', glow: 'rgba(6,182,212,0.3)',   icon: Briefcase },
  cajero:          { bg: '#2a0a2e', border: '#d946ef', text: '#e879f9', glow: 'rgba(217,70,239,0.3)',  icon: CreditCard },
  empleado:        { bg: '#1a1a2e', border: '#8b5cf6', text: '#a78bfa', glow: 'rgba(139,92,246,0.3)',  icon: Shield },
  usuario_final:   { bg: '#111111', border: '#525252', text: '#a3a3a3', glow: 'rgba(82,82,82,0.2)',    icon: User },
};

const DEFAULT_ROLE_COLOR = ROLE_COLORS.usuario_final!;

function getRoleColor(roleCode: string): typeof DEFAULT_ROLE_COLOR {
  return ROLE_COLORS[roleCode] ?? DEFAULT_ROLE_COLOR;
}

// ── Custom node component ──────────────────────────────────────────────
interface NetworkNodeData {
  node: NetworkNode;
  hasChildren: boolean;
  isExpanded: boolean;
  onToggle: (id: string) => void;
  isFocused: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function NetworkNodeComponent(props: Record<string, any>) {
  const nd = props.data as unknown as NetworkNodeData;
  if (!nd?.node) return null;
  const { node, hasChildren, isExpanded, onToggle, isFocused } = nd;
  const color = getRoleColor(node.primaryRole) ?? DEFAULT_ROLE_COLOR;
  const initials = (node.displayName || node.username)
    .split(/\s+/)
    .map((p: string) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      className={cn(
        'relative group min-w-[180px] max-w-[220px] rounded-lg border transition-all duration-200',
        node.isIndependentBranch && 'ring-1 ring-dashed',
        isFocused && 'ring-2 ring-[var(--color-accent)]',
      )}
      style={{
        background: color.bg,
        borderColor: color.border,
        boxShadow: `0 0 16px ${color.glow}`,
        ...(node.isIndependentBranch ? { ringColor: color.border } : {}),
      }}
    >
      <Handle type="target" position={Position.Left} className="!bg-transparent !border-0" />

      <div className="flex items-center gap-2 px-3 py-2.5">
        <div
          className="grid size-8 shrink-0 place-items-center rounded-md text-[11px] font-bold"
          style={{ background: `${color.border}22`, color: color.text }}
        >
          {node.isSystem ? <Crown size={14} /> : initials}
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-[12px] font-semibold truncate" style={{ color: color.text }}>
            {node.displayName || node.username}
          </span>
          <span className="text-[10px] truncate" style={{ color: `${color.text}99` }}>
            {node.roles[0]?.name ?? node.primaryRole}
          </span>
        </div>
      </div>

      {hasChildren && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggle(node.id); }}
          className="absolute -right-3 top-1/2 -translate-y-1/2 grid size-6 place-items-center rounded-full border bg-[var(--color-bg-elevated)] transition-transform hover:scale-110"
          style={{ borderColor: color.border, color: color.text }}
        >
          <ChevronRight
            size={12}
            className={cn('transition-transform duration-200', isExpanded && 'rotate-90')}
          />
        </button>
      )}

      <Handle type="source" position={Position.Right} className="!bg-transparent !border-0" />
    </div>
  );
}

const NetworkNodeMemo = memo(NetworkNodeComponent);

// ── Tree layout algorithm ──────────────────────────────────────────────
interface LayoutNode {
  id: string;
  x: number;
  y: number;
  data: NetworkNodeData;
  parentId: string | null;
}

const NODE_W = 200;
const NODE_H = 60;
const GAP_X = 60;
const GAP_Y = 40;

function layoutTree(
  nodes: NetworkNode[],
  expandedIds: Set<string>,
  rootIds: string[],
  childMap: Map<string, string[]>,
): LayoutNode[] {
  const result: LayoutNode[] = [];
  let globalY = 0;

  function walk(id: string, depth: number): number {
    const node = nodes.find((n) => n.id === id);
    if (!node) return 0;

    const children = childMap.get(id) ?? [];
    const isExpanded = expandedIds.has(id);
    const hasChildren = children.length > 0;

    const startY = globalY;

    if (isExpanded && hasChildren) {
      for (const childId of children) {
        walk(childId, depth + 1);
      }
    }

    const endY = globalY;
    const nodeY = hasChildren && isExpanded ? (startY + endY) / 2 : startY;

    result.push({
      id,
      x: depth * (NODE_W + GAP_X),
      y: nodeY,
      data: {
        node,
        hasChildren,
        isExpanded,
        onToggle: () => {},
        isFocused: false,
      },
      parentId: null,
    });

    if (!hasChildren || !isExpanded) {
      globalY += NODE_H + GAP_Y;
    }

    return globalY;
  }

  for (const rootId of rootIds) {
    if (globalY > 0) globalY += GAP_Y * 2;
    walk(rootId, 0);
  }

  return result;
}

// ── Main graph component ──────────────────────────────────────────────
interface NetworkGraphProps {
  nodes: NetworkNode[];
  focusUserId?: string | null;
}

export function NetworkGraph({ nodes, focusUserId }: NetworkGraphProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    // Default: expand root nodes (no parent) + first level children
    const roots = nodes.filter((n) => !n.parentUserId);
    const initial = new Set(roots.map((r) => r.id));
    for (const root of roots) {
      const children = nodes.filter((n) => n.parentUserId === root.id);
      for (const child of children) {
        if (nodes.some((n) => n.parentUserId === child.id)) {
          initial.add(child.id);
        }
      }
    }
    return initial;
  });

  // Build child map
  const childMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const n of nodes) {
      if (n.parentUserId) {
        const list = map.get(n.parentUserId) ?? [];
        list.push(n.id);
        map.set(n.parentUserId, list);
      }
    }
    return map;
  }, [nodes]);

  // Root nodes (no parent)
  const rootIds = useMemo(
    () => nodes.filter((n) => !n.parentUserId).map((n) => n.id),
    [nodes],
  );

  const toggleNode = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Focus on user: expand ancestors
  useEffect(() => {
    if (!focusUserId) return;
    const parentMap = new Map<string, string>();
    for (const n of nodes) {
      if (n.parentUserId) parentMap.set(n.id, n.parentUserId);
    }
    const toExpand: string[] = [];
    let current: string | null = focusUserId;
    while (current) {
      const parent = parentMap.get(current);
      if (parent) toExpand.push(parent);
      current = parent ?? null;
    }
    if (toExpand.length > 0) {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        for (const id of toExpand) next.add(id);
        return next;
      });
    }
  }, [focusUserId, nodes]);

  // Layout
  const layoutNodes = useMemo(
    () => layoutTree(nodes, expandedIds, rootIds, childMap),
    [nodes, expandedIds, rootIds, childMap],
  );

  // React Flow nodes
  const rfNodes: Node[] = useMemo(
    () =>
      layoutNodes.map((ln) => ({
        id: ln.id,
        position: { x: ln.x, y: ln.y },
        data: {
          ...ln.data,
          onToggle: toggleNode,
          isFocused: focusUserId === ln.id,
        },
        type: 'networkNode',
      })),
    [layoutNodes, toggleNode, focusUserId],
  );

  // React Flow edges
  const rfEdges: Edge[] = useMemo(() => {
    const edges: Edge[] = [];
    for (const n of layoutNodes) {
      // find parent in layout
      const parentNode = nodes.find((nd) => nd.id === n.id);
      if (parentNode?.parentUserId) {
        const sourceColor = getRoleColor(
          nodes.find((nd) => nd.id === parentNode.parentUserId)?.primaryRole ?? '',
        );
        edges.push({
          id: `${parentNode.parentUserId}-${n.id}`,
          source: parentNode.parentUserId,
          target: n.id,
          type: 'smoothstep',
          animated: false,
          style: { stroke: sourceColor.border, strokeWidth: 1.5, opacity: 0.6 },
          markerEnd: { type: MarkerType.ArrowClosed, color: sourceColor.border, width: 12, height: 12 },
        });
      }
    }
    return edges;
  }, [layoutNodes, nodes]);

  const nodeTypes = useMemo(() => ({ networkNode: NetworkNodeMemo }), []);

  const { fitView } = useReactFlow();

  const handleRecenter = useCallback(() => {
    fitView({ padding: 0.2, duration: 300 });
  }, [fitView]);

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        defaultEdgeOptions={{ type: 'smoothstep' }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} color="var(--color-border)" />
        <Controls
          showInteractive={false}
          className="!bg-[var(--color-bg-elevated)] !border-[var(--color-border)] !rounded-lg"
        />
        <MiniMap
          nodeColor={(n) => {
            const data = n.data as unknown as NetworkNodeData;
            return getRoleColor(data.node?.primaryRole ?? '').border;
          }}
          maskColor="rgba(0,0,0,0.6)"
          className="!bg-[var(--color-bg-subtle)] !border-[var(--color-border)] !rounded-lg"
          pannable
          zoomable
        />
      </ReactFlow>

      {/* Re-center button */}
      <button
        type="button"
        onClick={handleRecenter}
        className="absolute top-3 right-3 z-10 inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-1.5 text-[11px] font-medium text-[var(--color-fg)] transition-colors hover:border-[var(--color-accent-border)]"
      >
        Reubicar
      </button>

      {/* Legend */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)]/90 px-3 py-1.5 backdrop-blur">
        {Object.entries(ROLE_COLORS).map(([code, c]) => (
          <div key={code} className="flex items-center gap-1">
            <span className="size-2 rounded-full" style={{ background: c.border }} />
            <span className="text-[9px] text-[var(--color-fg-muted)] capitalize">{code.replace('_', ' ')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
