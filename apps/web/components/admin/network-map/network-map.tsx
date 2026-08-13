/**
 * NetworkMap — canvas del mapa de red con React Flow (Fase 1: solo lectura).
 * Navegación completa: zoom (rueda), pan (arrastrar fondo), minimapa y
 * "ajustar a pantalla" (en los Controls). Nodos arrastrables localmente (la
 * persistencia de posiciones llega en la Fase 2).
 */

'use client';

import { useEffect, useMemo } from 'react';
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
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { GroupNode, NetworkNodeCard, PlayersNode } from './network-node';
import { CASA_STYLE, PLAYERS_STYLE, roleStyle } from './roles';
import type { UserNodeData } from './layout';

const nodeTypes = {
  network: NetworkNodeCard,
  players: PlayersNode,
  group: GroupNode,
};

function miniMapColor(n: Node): string {
  const kind = (n.data as { kind?: string })?.kind;
  if (kind === 'casa') return CASA_STYLE.color;
  if (kind === 'players') return PLAYERS_STYLE.color;
  if (kind === 'group') return 'transparent';
  return roleStyle((n.data as UserNodeData).roleCode).color;
}

function Canvas({ nodes, edges }: { nodes: Node[]; edges: Edge[] }) {
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState(nodes);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState(edges);

  // Sync cuando cambian los datos (refetch). Fase 1: se recalcula el layout.
  useEffect(() => {
    setRfNodes(nodes);
  }, [nodes, setRfNodes]);
  useEffect(() => {
    setRfEdges(edges);
  }, [edges, setRfEdges]);

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
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
  );
}

export function NetworkMap({ nodes, edges }: { nodes: Node[]; edges: Edge[] }) {
  // memo defensivo para no re-crear en cada render del padre
  const n = useMemo(() => nodes, [nodes]);
  const e = useMemo(() => edges, [edges]);
  return (
    <ReactFlowProvider>
      <Canvas nodes={n} edges={e} />
    </ReactFlowProvider>
  );
}
