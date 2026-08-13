/**
 * NetworkMap — canvas del mapa de red con React Flow.
 * Fase 2: nodos arrastrables con posición persistida en el navegador,
 * colapsar/expandir ramas y nodo de jugadores clickeable. Navegación completa
 * (zoom, pan, minimapa, ajustar).
 */

'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { GroupNode, NetworkNodeCard, PlayersNode } from './network-node';
import { CASA_STYLE, PLAYERS_STYLE, roleStyle } from './roles';
import { NetworkMapProvider, type NetworkMapHandlers } from './network-map-context';
import { NODE_W, NODE_H, GROUP_PAD, type IndepOwner, type UserNodeData } from './layout';

const nodeTypes = {
  network: NetworkNodeCard,
  players: PlayersNode,
  group: GroupNode,
};

const POS_KEY = 'casino:network-map:positions';

type PosMap = Record<string, { x: number; y: number }>;

function loadPositions(): PosMap {
  try {
    const raw = window.localStorage.getItem(POS_KEY);
    return raw ? (JSON.parse(raw) as PosMap) : {};
  } catch {
    return {};
  }
}

function savePositions(p: PosMap): void {
  try {
    window.localStorage.setItem(POS_KEY, JSON.stringify(p));
  } catch {
    /* noop */
  }
}

function miniMapColor(n: Node): string {
  const kind = (n.data as { kind?: string })?.kind;
  if (kind === 'casa') return CASA_STYLE.color;
  if (kind === 'players') return PLAYERS_STYLE.color;
  if (kind === 'group') return 'transparent';
  return roleStyle((n.data as UserNodeData).roleCode).color;
}

interface CanvasProps {
  nodes: Node[];
  edges: Edge[];
  indepOwners: IndepOwner[];
  handlers: NetworkMapHandlers;
  resetToken: number;
  onSelectUser: (userId: string) => void;
}

function Canvas({ nodes, edges, indepOwners, handlers, resetToken, onSelectUser }: CanvasProps) {
  const savedRef = useRef<PosMap>({});
  // cargar posiciones guardadas una vez (client-only)
  useEffect(() => {
    savedRef.current = loadPositions();
  }, []);

  const applySaved = useCallback((ns: Node[]): Node[] => {
    const saved = savedRef.current;
    return ns.map((n) =>
      n.type !== 'group' && saved[n.id]
        ? { ...n, position: saved[n.id]! }
        : n,
    );
  }, []);

  const [rfNodes, setRfNodes, onNodesChangeBase] = useNodesState(nodes);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState(edges);

  // re-aplicar cuando cambia el layout (filtros/colapsos/datos)
  useEffect(() => {
    setRfNodes(applySaved(nodes));
  }, [nodes, applySaved, setRfNodes]);
  useEffect(() => {
    setRfEdges(edges);
  }, [edges, setRfEdges]);

  // reset de posiciones (botón "Reordenar")
  const firstReset = useRef(true);
  useEffect(() => {
    if (firstReset.current) {
      firstReset.current = false;
      return;
    }
    savedRef.current = {};
    savePositions({});
    setRfNodes(nodes);
  }, [resetToken, nodes, setRfNodes]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChangeBase(changes);
      // persistir posiciones al terminar de arrastrar
      for (const ch of changes) {
        if (ch.type === 'position' && ch.dragging === false && ch.position) {
          if (!ch.id.startsWith('group_')) {
            savedRef.current[ch.id] = ch.position;
          }
        }
      }
      const hasDrop = changes.some(
        (c) => c.type === 'position' && c.dragging === false,
      );
      if (hasDrop) savePositions(savedRef.current);
    },
    [onNodesChangeBase],
  );

  // Recuadros de ramas independientes: se calculan con las posiciones VIVAS
  // de los nodos, así siguen a los nodos cuando los arrastrás.
  const groupNodes = useMemo<Node[]>(() => {
    const out: Node[] = [];
    for (const owner of indepOwners) {
      const members = rfNodes.filter(
        (n) => (n.data as { indepOwner?: string | null }).indepOwner === owner.id,
      );
      if (members.length === 0) continue;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const m of members) {
        minX = Math.min(minX, m.position.x);
        minY = Math.min(minY, m.position.y);
        maxX = Math.max(maxX, m.position.x + NODE_W);
        maxY = Math.max(maxY, m.position.y + NODE_H);
      }
      const w = maxX - minX + GROUP_PAD * 2;
      const h = maxY - minY + GROUP_PAD * 2 + 18;
      out.push({
        id: `group_${owner.id}`,
        type: 'group',
        position: { x: minX - GROUP_PAD, y: minY - GROUP_PAD - 18 },
        data: { kind: 'group', label: owner.label },
        draggable: false,
        selectable: false,
        zIndex: -1,
        width: w,
        height: h,
        style: { width: w, height: h },
      });
    }
    return out;
  }, [rfNodes, indepOwners]);

  const allNodes = useMemo(() => [...groupNodes, ...rfNodes], [groupNodes, rfNodes]);

  return (
    <NetworkMapProvider value={handlers}>
      <ReactFlow
        nodes={allNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => {
          const kind = (node.data as { kind?: string })?.kind;
          if (node.type === 'network' && kind === 'user') onSelectUser(node.id);
        }}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        minZoom={0.15}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        nodesConnectable={false}
        elementsSelectable
        className="bg-[var(--color-bg)]"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1}
          color="rgba(148,163,184,0.14)"
        />
        <Controls
          showInteractive={false}
          className="!bg-[var(--color-bg-elevated)] !border !border-[var(--color-border)] [&_button]:!bg-[var(--color-bg-elevated)] [&_button]:!border-[var(--color-border)] [&_button]:!fill-[var(--color-fg-muted)]"
        />
        <MiniMap
          pannable
          zoomable
          nodeColor={miniMapColor}
          nodeStrokeWidth={0}
          maskColor="rgba(0,0,0,0.55)"
          className="!bg-[var(--color-bg-elevated)] !border !border-[var(--color-border)]"
        />
      </ReactFlow>
    </NetworkMapProvider>
  );
}

export function NetworkMap({
  nodes,
  edges,
  indepOwners,
  handlers,
  resetToken,
  onSelectUser,
}: {
  nodes: Node[];
  edges: Edge[];
  indepOwners: IndepOwner[];
  handlers: NetworkMapHandlers;
  resetToken: number;
  onSelectUser: (userId: string) => void;
}) {
  const n = useMemo(() => nodes, [nodes]);
  const e = useMemo(() => edges, [edges]);
  return (
    <ReactFlowProvider>
      <Canvas
        nodes={n}
        edges={e}
        indepOwners={indepOwners}
        handlers={handlers}
        resetToken={resetToken}
        onSelectUser={onSelectUser}
      />
    </ReactFlowProvider>
  );
}
