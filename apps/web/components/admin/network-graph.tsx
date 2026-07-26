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
  BaseEdge,
  getSmoothStepPath,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { memo, useCallback, useEffect, useMemo } from 'react';
import { User, Shield, Crown, Briefcase, CreditCard, Store } from 'lucide-react';
import type { NetworkNode } from '@/lib/hooks/use-network-tree';
import { cn } from '@/lib/cn';

// ── Role styling matching the reference design ──────────────────────────
const ROLE_STYLES: Record<string, {
  icon: typeof User;
  iconColor: string;
  roleColor: string;
  nodeBorder: string;
  nodeBg: string;
  rootBg: string;
  rootBorder: string;
}> = {
  admin_tenant: {
    icon: Crown,
    iconColor: '#f59e0b',
    roleColor: '#f59e0b',
    nodeBorder: 'rgba(245,158,11,0.25)',
    nodeBg: '#111111',
    rootBg: 'linear-gradient(135deg, #2a1f04 0%, #1a1200 100%)',
    rootBorder: '#22c55e',
  },
  socio: {
    icon: Store,
    iconColor: '#22c55e',
    roleColor: '#22c55e',
    nodeBorder: 'rgba(34,197,94,0.25)',
    nodeBg: '#111111',
    rootBg: 'linear-gradient(135deg, #0a2818 0%, #061a10 100%)',
    rootBorder: '#22c55e',
  },
  distribuidor: {
    icon: Briefcase,
    iconColor: '#06b6d4',
    roleColor: '#06b6d4',
    nodeBorder: 'rgba(6,182,212,0.25)',
    nodeBg: '#111111',
    rootBg: 'linear-gradient(135deg, #0a1a2e 0%, #06101f 100%)',
    rootBorder: '#06b6d4',
  },
  cajero: {
    icon: CreditCard,
    iconColor: '#d946ef',
    roleColor: '#d946ef',
    nodeBorder: 'rgba(217,70,239,0.25)',
    nodeBg: '#111111',
    rootBg: 'linear-gradient(135deg, #2a0a2e 0%, #1a0520 100%)',
    rootBorder: '#d946ef',
  },
  empleado: {
    icon: Shield,
    iconColor: '#8b5cf6',
    roleColor: '#8b5cf6',
    nodeBorder: 'rgba(139,92,246,0.25)',
    nodeBg: '#111111',
    rootBg: 'linear-gradient(135deg, #1a1a2e 0%, #0f0f1f 100%)',
    rootBorder: '#8b5cf6',
  },
  usuario_final: {
    icon: User,
    iconColor: '#a3a3a3',
    roleColor: '#a3a3a3',
    nodeBorder: 'rgba(163,163,163,0.2)',
    nodeBg: '#111111',
    rootBg: 'linear-gradient(135deg, #1a1a1a 0%, #111111 100%)',
    rootBorder: '#a3a3a3',
  },
};

const DEFAULT_ROLE_STYLE: typeof ROLE_STYLES[string] = ROLE_STYLES.usuario_final!;

function getRoleStyle(roleCode: string): typeof ROLE_STYLES[string] {
  return ROLE_STYLES[roleCode] ?? DEFAULT_ROLE_STYLE;
}

// ── Custom node component ──────────────────────────────────────────────
interface NetworkNodeData {
  node: NetworkNode;
  hasChildren: boolean;
  isExpanded: boolean;
  childCount: number;
  isFocused: boolean;
  isRoot: boolean;
  onToggle: (id: string) => void;
}

function NetworkNodeComponent(props: any) {
  const nd = props.data as NetworkNodeData;
  if (!nd?.node) return null;
  const { node, hasChildren, isExpanded, childCount, isFocused, isRoot, onToggle } = nd;
  const style = getRoleStyle(node.primaryRole);
  const Icon = style.icon;

  const displayName = node.displayName || node.username;
  const roleLabel = node.roles[0]?.name ?? node.primaryRole.replace(/_/g, ' ');

  return (
    <div
      className={cn(
        'relative group rounded-xl transition-all duration-200 select-none',
        isFocused && 'ring-2 ring-white/40',
      )}
      style={{
        width: 220,
        background: isRoot ? style.rootBg : style.nodeBg,
        border: `1px solid ${isRoot ? style.rootBorder : style.nodeBorder}`,
        boxShadow: isFocused
          ? `0 0 30px ${style.roleColor}40`
          : isRoot
            ? `0 0 20px ${style.rootBorder}20`
            : '0 2px 8px rgba(0,0,0,0.3)',
      }}
      onDoubleClick={() => {
        window.location.href = `/users/${node.id}`;
      }}
    >
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-transparent !border-0 !-left-1" />

      <div className="flex items-center gap-3 px-4 py-3">
        <div
          className="grid size-10 shrink-0 place-items-center rounded-lg"
          style={{ background: `${style.iconColor}15` }}
        >
          <Icon size={18} style={{ color: style.iconColor }} />
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-[13px] font-semibold text-white truncate">
            {displayName}
          </span>
          <span className="text-[11px] font-medium truncate" style={{ color: style.roleColor }}>
            {roleLabel}
          </span>
        </div>
      </div>

      {hasChildren && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggle(node.id); }}
          className="w-full flex items-center justify-center gap-1.5 border-t py-1.5 cursor-pointer hover:bg-white/5 transition-colors"
          style={{ borderColor: `${style.roleColor}20` }}
        >
          <svg
            width="8" height="8" viewBox="0 0 8 8"
            className={cn('transition-transform duration-200', isExpanded && 'rotate-90')}
          >
            <path d="M2 0 L6 4 L2 8" fill="none" stroke={style.roleColor} strokeWidth="1.5" />
          </svg>
          <span className="text-[10px] tabular-nums" style={{ color: `${style.roleColor}99` }}>
            {childCount} {childCount === 1 ? 'hijo' : 'hijos'}
          </span>
        </button>
      )}

      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-transparent !border-0 !-right-1" />
    </div>
  );
}

const NetworkNodeMemo = memo(NetworkNodeComponent);

// ── Custom bracket edge ────────────────────────────────────────────────
function BracketEdge(props: any) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style: edgeStyle, markerEnd } = props;

  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 8,
  });

  return (
    <BaseEdge
      path={edgePath}
      markerEnd={markerEnd}
      style={{
        strokeWidth: 1.5,
        stroke: edgeStyle?.stroke ?? 'rgba(255,255,255,0.15)',
        opacity: 0.6,
        ...edgeStyle,
      }}
    />
  );
}

const BracketEdgeMemo = memo(BracketEdge);

// ── Layout algorithm ───────────────────────────────────────────────────
const NODE_W = 220;
const NODE_H = 64;
const GAP_X = 100;
const GAP_Y = 20;

interface LayoutNode {
  id: string;
  x: number;
  y: number;
  data: NetworkNodeData;
}

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
    const isRoot = depth === 0;

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
      : startY;

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
        isRoot,
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
    if (globalY > 0) globalY += GAP_Y * 3;
    walk(rootId, 0);
  }

  return { layoutNodes: result, edgePairs };
}

// ── Main graph component ──────────────────────────────────────────────
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

  // Focus: expand ancestors
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
      if (parent && !expandedIds.has(parent)) toExpand.push(parent);
      current = parent ?? null;
    }
    for (const id of toExpand) {
      onToggleNode(id);
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
        selectable: false,
      })),
    [layoutNodes, focusUserId, onToggleNode],
  );

  const visibleIds = useMemo(() => new Set(layoutNodes.map((n) => n.id)), [layoutNodes]);

  const rfEdges: Edge[] = useMemo(() => {
    return edgePairs
      .filter((ep) => visibleIds.has(ep.source) && visibleIds.has(ep.target))
      .map((ep) => {
        const sourceNode = nodes.find((n) => n.id === ep.source);
        const sourceStyle = getRoleStyle(sourceNode?.primaryRole ?? '');
        return {
          id: `${ep.source}-${ep.target}`,
          source: ep.source,
          target: ep.target,
          type: 'bracket',
          style: { stroke: sourceStyle.roleColor },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: sourceStyle.roleColor,
            width: 12,
            height: 12,
          },
        };
      });
  }, [edgePairs, visibleIds, nodes]);

  const nodeTypes = useMemo(() => ({ networkNode: NetworkNodeMemo }), []);
  const edgeTypes = useMemo(() => ({ bracket: BracketEdgeMemo }), []);
  const { fitView } = useReactFlow();

  const handleRecenter = useCallback(() => {
    fitView({ padding: 0.2, duration: 300 });
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
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.05}
        maxZoom={2}
        defaultEdgeOptions={{ type: 'bracket' }}
        proOptions={{ hideAttribution: true }}
        onPaneClick={handlePaneClick}
        onNodeClick={handleNodeClick}
        nodesDraggable
        panOnDrag
        zoomOnScroll
        zoomOnPinch
      >
        <Background gap={32} size={1} color="rgba(255,255,255,0.02)" />
        <Controls
          showInteractive={false}
          className="!bg-[var(--color-bg-elevated)] !border-[var(--color-border)] !rounded-lg !shadow-lg"
        />
        <MiniMap
          nodeColor={(n) => {
            const data = n.data as unknown as NetworkNodeData | undefined;
            return getRoleStyle(data?.node?.primaryRole ?? '').roleColor;
          }}
          maskColor="rgba(0,0,0,0.7)"
          className="!bg-[var(--color-bg-subtle)] !border-[var(--color-border)] !rounded-lg"
          pannable
          zoomable
        />
      </ReactFlow>

      {/* Re-center */}
      <button
        type="button"
        onClick={handleRecenter}
        className="absolute top-3 right-3 z-10 inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-1.5 text-[11px] font-medium text-[var(--color-fg)] shadow-lg transition-colors hover:border-[var(--color-accent-border)]"
      >
        Reubicar
      </button>

      {/* Legend */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)]/95 px-4 py-2 backdrop-blur shadow-lg">
        {Object.entries(ROLE_STYLES).map(([code, s]) => (
          <div key={code} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ background: s.roleColor }} />
            <span className="text-[10px] text-[var(--color-fg-muted)]">{code.replace(/_/g, ' ')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
