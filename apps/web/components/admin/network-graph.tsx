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
import { memo, useCallback, useEffect, useMemo } from 'react';
import { ChevronRight, User, Shield, Crown, Briefcase, CreditCard, Store } from 'lucide-react';
import type { NetworkNode } from '@/lib/hooks/use-network-tree';
import { cn } from '@/lib/cn';

const ROLE_COLORS: Record<string, { bg: string; border: string; text: string; glow: string; icon: typeof User }> = {
  admin_tenant:    { bg: '#2a1f04', border: '#f59e0b', text: '#fbbf24', glow: 'rgba(245,158,11,0.4)', icon: Crown },
  socio:           { bg: '#0a2818', border: '#22c55e', text: '#4ade80', glow: 'rgba(34,197,94,0.4)',   icon: Store },
  distribuidor:    { bg: '#0a1a2e', border: '#06b6d4', text: '#22d3ee', glow: 'rgba(6,182,212,0.4)',   icon: Briefcase },
  cajero:          { bg: '#2a0a2e', border: '#d946ef', text: '#e879f9', glow: 'rgba(217,70,239,0.4)',  icon: CreditCard },
  empleado:        { bg: '#1a1a2e', border: '#8b5cf6', text: '#a78bfa', glow: 'rgba(139,92,246,0.4)',  icon: Shield },
  usuario_final:   { bg: '#111111', border: '#525252', text: '#a3a3a3', glow: 'rgba(82,82,82,0.2)',    icon: User },
};

const DEFAULT_ROLE_COLOR: { bg: string; border: string; text: string; glow: string; icon: typeof User } = ROLE_COLORS.usuario_final!;

function getRoleColor(roleCode: string): { bg: string; border: string; text: string; glow: string; icon: typeof User } {
  return ROLE_COLORS[roleCode] ?? DEFAULT_ROLE_COLOR;
}

interface NetworkNodeData {
  node: NetworkNode;
  hasChildren: boolean;
  isExpanded: boolean;
  childCount: number;
  isFocused: boolean;
  onToggle: (id: string) => void;
}

function NetworkNodeComponent(props: any) {
  const nd = props.data as NetworkNodeData;
  if (!nd?.node) return null;
  const { node, hasChildren, isExpanded, childCount, isFocused, onToggle } = nd;
  const color = getRoleColor(node.primaryRole);
  const initials = (node.displayName || node.username)
    .split(/\s+/)
    .map((p: string) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      className={cn(
        'relative rounded-lg border transition-all duration-200 select-none',
        node.isIndependentBranch && 'ring-1 ring-dashed',
        isFocused && 'ring-2 ring-white/60',
      )}
      style={{
        background: color.bg,
        borderColor: color.border,
        boxShadow: isFocused ? `0 0 24px ${color.glow}, 0 0 48px ${color.glow}` : `0 0 12px ${color.glow}`,
        width: 200,
      }}
      onDoubleClick={() => {
        window.location.href = `/users/${node.id}`;
      }}
    >
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-transparent !border-0 !-left-1" />

      <div className="flex items-center gap-2 px-3 py-2">
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
            {node.roles[0]?.name ?? node.primaryRole.replace(/_/g, ' ')}
          </span>
        </div>
      </div>

      {hasChildren && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggle(node.id); }}
          className="w-full flex items-center justify-center gap-1 border-t py-1 cursor-pointer hover:bg-white/5 transition-colors"
          style={{ borderColor: `${color.border}33` }}
        >
          <ChevronRight
            size={10}
            className={cn('transition-transform duration-200', isExpanded && 'rotate-90')}
            style={{ color: color.text }}
          />
          <span className="text-[9px] tabular-nums" style={{ color: `${color.text}99` }}>
            {childCount} {childCount === 1 ? 'hijo' : 'hijos'}
          </span>
        </button>
      )}

      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-transparent !border-0 !-right-1" />
    </div>
  );
}

const NetworkNodeMemo = memo(NetworkNodeComponent);

const NODE_W = 200;
const NODE_H = 60;
const GAP_X = 80;
const GAP_Y = 30;

function layoutTree(
  nodes: NetworkNode[],
  expandedIds: Set<string>,
  rootIds: string[],
  childMap: Map<string, string[]>,
): { layoutNodes: LayoutNode[]; edgePairs: Array<{ source: string; target: string }> } {
  const result: LayoutNode[] = [];
  const edgePairs: Array<{ source: string; target: string }> = [];
  let globalY = 0;

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  function walk(id: string, depth: number): void {
    const node = nodeMap.get(id);
    if (!node) return;

    const children = childMap.get(id) ?? [];
    const isExpanded = expandedIds.has(id);
    const hasChildren = children.length > 0;

    const startY = globalY;

    if (isExpanded && hasChildren) {
      for (const childId of children) {
        walk(childId, depth + 1);
        edgePairs.push({ source: id, target: childId });
      }
    }

    const endY = globalY;
    const nodeY = hasChildren && isExpanded
      ? (startY + endY) / 2
      : startY + (hasChildren && !isExpanded ? 10 : 0);

    result.push({
      id,
      x: depth * (NODE_W + GAP_X),
      y: nodeY,
      data: {
        node,
        hasChildren,
        isExpanded,
        childCount: children.length,
        isFocused: false,
        onToggle: () => {},
      },
    });

    if (!hasChildren || !isExpanded) {
      globalY += NODE_H + GAP_Y;
    } else {
      globalY += GAP_Y;
    }
  }

  for (const rootId of rootIds) {
    if (globalY > 0) globalY += GAP_Y * 2;
    walk(rootId, 0);
  }

  return { layoutNodes: result, edgePairs };
}

interface LayoutNode {
  id: string;
  x: number;
  y: number;
  data: NetworkNodeData;
}

interface NetworkGraphProps {
  nodes: NetworkNode[];
  focusUserId?: string | null;
  onSelectUser?: (id: string | null) => void;
  expandedIds: Set<string>;
  onToggleNode: (id: string) => void;
}

export function NetworkGraph({ nodes, focusUserId, onSelectUser, expandedIds, onToggleNode }: NetworkGraphProps) {
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

  const rootIds = useMemo(
    () => nodes.filter((n) => !n.parentUserId).map((n) => n.id),
    [nodes],
  );

  // Focus: expand ancestors of the focused user
  const expandedIdsRef = useMemo(() => expandedIds, [expandedIds]);
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
      if (parent && !expandedIdsRef.has(parent)) toExpand.push(parent);
      current = parent ?? null;
    }
    if (toExpand.length > 0) {
      for (const id of toExpand) {
        onToggleNode(id);
      }
    }
  }, [focusUserId, nodes]);

  const { layoutNodes, edgePairs } = useMemo(
    () => layoutTree(nodes, expandedIds, rootIds, childMap),
    [nodes, expandedIds, rootIds, childMap],
  );

  const rfNodes: Node[] = useMemo(
    () =>
      layoutNodes.map((ln) => ({
        id: ln.id,
        position: { x: ln.x, y: ln.y },
        data: {
          ...ln.data,
          isFocused: focusUserId === ln.id,
          onToggle: onToggleNode,
        },
        type: 'networkNode',
        draggable: true,
        selectable: true,
      })),
    [layoutNodes, focusUserId, onToggleNode],
  );

  const visibleIds = useMemo(() => new Set(layoutNodes.map((n) => n.id)), [layoutNodes]);

  const rfEdges: Edge[] = useMemo(() => {
    return edgePairs
      .filter((ep) => visibleIds.has(ep.source) && visibleIds.has(ep.target))
      .map((ep) => {
        const sourceNode = nodes.find((n) => n.id === ep.source);
        const sourceColor = getRoleColor(sourceNode?.primaryRole ?? '');
        return {
          id: `${ep.source}-${ep.target}`,
          source: ep.source,
          target: ep.target,
          type: 'smoothstep',
          style: { stroke: sourceColor.border, strokeWidth: 1.5, opacity: 0.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color: sourceColor.border, width: 10, height: 10 },
        };
      });
  }, [edgePairs, visibleIds, nodes]);

  const nodeTypes = useMemo(() => ({ networkNode: NetworkNodeMemo }), []);
  const { fitView } = useReactFlow();

  const handleRecenter = useCallback(() => {
    fitView({ padding: 0.15, duration: 300 });
  }, [fitView]);

  const handlePaneClick = useCallback(() => {
    onSelectUser?.(null);
  }, [onSelectUser]);

  const handleNodeClick = useCallback((_: any, node: Node) => {
    onSelectUser?.(node.id);
  }, [onSelectUser]);

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.05}
        maxZoom={2}
        defaultEdgeOptions={{ type: 'smoothstep' }}
        proOptions={{ hideAttribution: true }}
        onPaneClick={handlePaneClick}
        onNodeClick={handleNodeClick}
        nodesDraggable
        panOnDrag
        zoomOnScroll
        zoomOnPinch
      >
        <Background gap={24} size={1} color="rgba(255,255,255,0.04)" />
        <Controls
          showInteractive={false}
          className="!bg-[var(--color-bg-elevated)] !border-[var(--color-border)] !rounded-lg !shadow-lg"
        />
        <MiniMap
          nodeColor={(n) => {
            const data = n.data as unknown as NetworkNodeData | undefined;
            return getRoleColor(data?.node?.primaryRole ?? '').border;
          }}
          maskColor="rgba(0,0,0,0.7)"
          className="!bg-[var(--color-bg-subtle)] !border-[var(--color-border)] !rounded-lg"
          pannable
          zoomable
        />
      </ReactFlow>

      <button
        type="button"
        onClick={handleRecenter}
        className="absolute top-3 right-3 z-10 inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-1.5 text-[11px] font-medium text-[var(--color-fg)] shadow-lg transition-colors hover:border-[var(--color-accent-border)]"
      >
        Reubicar
      </button>

      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)]/95 px-4 py-2 backdrop-blur shadow-lg">
        {Object.entries(ROLE_COLORS).map(([code, c]) => (
          <div key={code} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ background: c.border }} />
            <span className="text-[10px] text-[var(--color-fg-muted)]">{code.replace(/_/g, ' ')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
