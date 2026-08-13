/**
 * Construcción del grafo del mapa de red (Fase 1) a partir del árbol plano
 * que devuelve el backend (`useNetworkTree`).
 *
 * Reglas (definidas con el dueño):
 *   - Raíz sintética "La Casa" → cuelgan todos los tops del tenant.
 *   - Cadena comercial: admin, socio, distribuidor, cajero. Empleados y
 *     cuentas de sistema NO se muestran.
 *   - Jugadores (usuario_final): NO se dibujan individualmente; cada nodo con
 *     jugadores directos muestra UN nodo agrupado "N jugadores".
 *   - Orientación horizontal (izq→der): auto-layout tidy-tree.
 *   - Cada nodo trae el total de gente que cuelga (recursivo).
 *   - Socios independientes: se marca su sub-red con un recuadro contenedor.
 */

import type { Edge, Node } from '@xyflow/react';
import type { NetworkNode } from '@/lib/hooks/use-network-tree';

export const NODE_W = 214;
export const NODE_H = 64;
const X_GAP = 300; // separación horizontal por nivel (incluye ancho de nodo)
const Y_GAP = 92; // separación vertical entre hojas
const GROUP_PAD = 26; // padding del recuadro de rama independiente

const HIDDEN_ROLES = new Set(['empleado']);
const COMMERCIAL_ROLES = new Set([
  'admin_tenant',
  'socio',
  'distribuidor',
  'cajero',
]);

export interface UserNodeData {
  kind: 'casa' | 'user';
  userId?: string;
  label: string;
  username?: string;
  roleCode: string;
  status: string;
  descendantCount: number;
  isIndependent: boolean;
  [key: string]: unknown;
}

export interface PlayersNodeData {
  kind: 'players';
  label: string;
  playerCount: number;
  parentUserId: string;
  [key: string]: unknown;
}

export interface GroupNodeData {
  kind: 'group';
  label: string;
  [key: string]: unknown;
}

interface LayoutNode {
  id: string;
  type: 'network' | 'players' | 'group';
  data: UserNodeData | PlayersNodeData;
  depth: number;
  x: number;
  y: number;
  children: LayoutNode[];
  /** id del socio independiente dueño del recuadro que contiene a este nodo. */
  independentOwnerId: string | null;
}

const CASA_ID = '__casa_root__';

/** Rol principal "de display": el primer rol comercial, o el primario. */
function displayRole(n: NetworkNode): string {
  const commercial = n.roles.find((r) => COMMERCIAL_ROLES.has(r.code));
  if (commercial) return commercial.code;
  return n.primaryRole || n.roles[0]?.code || 'usuario_final';
}

function isPlayer(n: NetworkNode): boolean {
  return displayRole(n) === 'usuario_final';
}

export function buildGraph(nodes: NetworkNode[]): {
  rfNodes: Node[];
  rfEdges: Edge[];
} {
  const real = nodes.filter((n) => !n.isSystem);
  const byId = new Map(real.map((n) => [n.id, n]));

  // children de cada padre (solo entre nodos reales presentes)
  const childrenOf = new Map<string, NetworkNode[]>();
  const roots: NetworkNode[] = [];
  for (const n of real) {
    const p = n.parentUserId;
    if (p && byId.has(p)) {
      const arr = childrenOf.get(p) ?? [];
      arr.push(n);
      childrenOf.set(p, arr);
    } else {
      roots.push(n);
    }
  }

  // total de descendientes (recursivo, toda persona que cuelga)
  const descMemo = new Map<string, number>();
  const countDesc = (id: string): number => {
    const cached = descMemo.get(id);
    if (cached !== undefined) return cached;
    const kids = childrenOf.get(id) ?? [];
    let total = kids.length;
    for (const k of kids) total += countDesc(k.id);
    descMemo.set(id, total);
    return total;
  };

  // ── construir el árbol de display ──────────────────────────────────
  const casaRoot: LayoutNode = {
    id: CASA_ID,
    type: 'network',
    data: {
      kind: 'casa',
      label: 'La Casa',
      roleCode: 'casa',
      status: 'active',
      descendantCount: real.length,
      isIndependent: false,
    },
    depth: 0,
    x: 0,
    y: 0,
    children: [],
    independentOwnerId: null,
  };

  const buildChildren = (
    parent: NetworkNode,
    depth: number,
    independentOwnerId: string | null,
  ): LayoutNode[] => {
    const kids = childrenOf.get(parent.id) ?? [];
    const out: LayoutNode[] = [];
    let playerCount = 0;

    for (const k of kids) {
      const role = displayRole(k);
      if (HIDDEN_ROLES.has(role)) continue;
      if (isPlayer(k)) {
        playerCount += 1;
        continue;
      }
      // nodo comercial (socio/distribuidor/cajero)
      const owns = k.isIndependentBranch && role === 'socio';
      const owner = owns ? k.id : independentOwnerId;
      const ln: LayoutNode = {
        id: k.id,
        type: 'network',
        data: {
          kind: 'user',
          userId: k.id,
          label: k.displayName || k.username,
          username: k.username,
          roleCode: role,
          status: k.status,
          descendantCount: countDesc(k.id),
          isIndependent: !!k.isIndependentBranch,
        },
        depth,
        x: 0,
        y: 0,
        children: buildChildren(k, depth + 1, owner),
        independentOwnerId: owner,
      };
      out.push(ln);
    }

    // nodo agrupado de jugadores directos
    if (playerCount > 0) {
      out.push({
        id: `players_${parent.id}`,
        type: 'players',
        data: {
          kind: 'players',
          label: `${playerCount} ${playerCount === 1 ? 'jugador' : 'jugadores'}`,
          playerCount,
          parentUserId: parent.id,
        },
        depth,
        x: 0,
        y: 0,
        children: [],
        independentOwnerId,
      });
    }
    return out;
  };

  // roots reales → hijos de La Casa (excluye jugadores/empleados directos:
  // los jugadores directos del admin se agrupan aparte)
  let rootPlayerCount = 0;
  for (const r of roots) {
    const role = displayRole(r);
    if (HIDDEN_ROLES.has(role)) continue;
    if (isPlayer(r)) {
      rootPlayerCount += 1;
      continue;
    }
    const owns = r.isIndependentBranch && role === 'socio';
    const owner = owns ? r.id : null;
    casaRoot.children.push({
      id: r.id,
      type: 'network',
      data: {
        kind: 'user',
        userId: r.id,
        label: r.displayName || r.username,
        username: r.username,
        roleCode: role,
        status: r.status,
        descendantCount: countDesc(r.id),
        isIndependent: !!r.isIndependentBranch,
      },
      depth: 1,
      x: 0,
      y: 0,
      children: buildChildren(r, 2, owner),
      independentOwnerId: owner,
    });
  }
  if (rootPlayerCount > 0) {
    casaRoot.children.push({
      id: `players_${CASA_ID}`,
      type: 'players',
      data: {
        kind: 'players',
        label: `${rootPlayerCount} ${rootPlayerCount === 1 ? 'jugador' : 'jugadores'}`,
        playerCount: rootPlayerCount,
        parentUserId: CASA_ID,
      },
      depth: 1,
      x: 0,
      y: 0,
      children: [],
      independentOwnerId: null,
    });
  }

  // ── layout tidy-tree horizontal ────────────────────────────────────
  let leafCursor = 0;
  const assign = (n: LayoutNode): void => {
    n.x = n.depth * X_GAP;
    if (n.children.length === 0) {
      n.y = leafCursor;
      leafCursor += Y_GAP;
      return;
    }
    for (const c of n.children) assign(c);
    n.y = (n.children[0]!.y + n.children[n.children.length - 1]!.y) / 2;
  };
  assign(casaRoot);

  // ── aplanar a nodos/aristas de React Flow ──────────────────────────
  const rfNodes: Node[] = [];
  const rfEdges: Edge[] = [];
  const flat: LayoutNode[] = [];
  const walk = (n: LayoutNode, parentId: string | null) => {
    flat.push(n);
    rfNodes.push({
      id: n.id,
      type: n.type,
      position: { x: n.x, y: n.y },
      data: n.data,
      draggable: true,
    });
    if (parentId) {
      rfEdges.push({
        id: `e_${parentId}_${n.id}`,
        source: parentId,
        target: n.id,
        type: 'smoothstep',
        style: { stroke: 'rgba(148,163,184,0.35)', strokeWidth: 1.5 },
      });
    }
    for (const c of n.children) walk(c, n.id);
  };
  walk(casaRoot, null);

  // ── recuadros de ramas independientes ──────────────────────────────
  // bounding box del subárbol de cada socio independiente
  const boxes = new Map<
    string,
    { minX: number; minY: number; maxX: number; maxY: number; label: string }
  >();
  for (const n of flat) {
    const owner = n.independentOwnerId;
    if (!owner) continue;
    const b = boxes.get(owner) ?? {
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
      label: '',
    };
    b.minX = Math.min(b.minX, n.x);
    b.minY = Math.min(b.minY, n.y);
    b.maxX = Math.max(b.maxX, n.x + NODE_W);
    b.maxY = Math.max(b.maxY, n.y + NODE_H);
    boxes.set(owner, b);
  }
  for (const [ownerId, b] of boxes) {
    const owner = byId.get(ownerId);
    const groupNode: Node = {
      id: `group_${ownerId}`,
      type: 'group',
      position: { x: b.minX - GROUP_PAD, y: b.minY - GROUP_PAD - 18 },
      data: {
        kind: 'group',
        label: `Red independiente · ${owner?.displayName || owner?.username || ''}`,
      },
      draggable: false,
      selectable: false,
      zIndex: -1,
      width: b.maxX - b.minX + GROUP_PAD * 2,
      height: b.maxY - b.minY + GROUP_PAD * 2 + 18,
      style: {
        width: b.maxX - b.minX + GROUP_PAD * 2,
        height: b.maxY - b.minY + GROUP_PAD * 2 + 18,
      },
    };
    rfNodes.unshift(groupNode); // atrás
  }

  return { rfNodes, rfEdges };
}
