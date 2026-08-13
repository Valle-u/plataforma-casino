/**
 * Construcción del grafo del mapa de red a partir del árbol plano del backend
 * (`useNetworkTree`). Fase 2: soporta colapsar ramas, búsqueda (filtra a la
 * rama), filtros (rol / estado / independencia / rama aislada).
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
export const GROUP_PAD = 26;
const X_GAP = 300;
const Y_GAP = 92;

const HIDDEN_ROLES = new Set(['empleado']);
const COMMERCIAL_ROLES = new Set([
  'admin_tenant',
  'socio',
  'distribuidor',
  'cajero',
]);

export const CASA_ID = '__casa_root__';

export interface UserNodeData {
  kind: 'casa' | 'user';
  userId?: string;
  label: string;
  username?: string;
  roleCode: string;
  status: string;
  descendantCount: number;
  isIndependent: boolean;
  hasChildren: boolean;
  collapsed: boolean;
  [key: string]: unknown;
}

export interface PlayersNodeData {
  kind: 'players';
  label: string;
  playerCount: number;
  parentUserId: string;
  parentLabel: string;
  [key: string]: unknown;
}

export interface GroupNodeData {
  kind: 'group';
  label: string;
  [key: string]: unknown;
}

/** Filtros del mapa (barra superior). */
export interface NetworkFilters {
  /** roles comerciales visibles: subconjunto de socio/distribuidor/cajero + 'jugadores'. */
  roles: Set<string>;
  /** estados visibles: subconjunto de active/inactive/suspended/banned. */
  statuses: Set<string>;
  independence: 'all' | 'independent' | 'dependent';
  branchRootId: string | null;
  search: string;
}

export interface BuildOptions {
  collapsed: Set<string>;
  filters: NetworkFilters;
}

export const ALL_FILTER_ROLES = ['socio', 'distribuidor', 'cajero', 'jugadores'];
export const ALL_FILTER_STATUSES = ['active', 'inactive', 'suspended', 'banned'];

export function defaultFilters(): NetworkFilters {
  return {
    roles: new Set(ALL_FILTER_ROLES),
    statuses: new Set(ALL_FILTER_STATUSES),
    independence: 'all',
    branchRootId: null,
    search: '',
  };
}

interface LNode {
  id: string;
  type: 'network' | 'players' | 'group';
  data: UserNodeData | PlayersNodeData;
  children: LNode[];
  independentOwnerId: string | null;
  // filtros / layout
  filterRole: string; // 'socio'|'distribuidor'|'cajero'|'jugadores'|'admin'|'casa'
  status: string;
  inIndependent: boolean;
  matchesSearch: boolean;
  hidden: boolean;
  depth: number;
  x: number;
  y: number;
}

function displayRole(n: NetworkNode): string {
  const commercial = n.roles.find((r) => COMMERCIAL_ROLES.has(r.code));
  if (commercial) return commercial.code;
  return n.primaryRole || n.roles[0]?.code || 'usuario_final';
}

function isPlayer(n: NetworkNode): boolean {
  return displayRole(n) === 'usuario_final';
}

/** rank de ordenamiento: las ramas independientes van al fondo (abajo). */
const indepRank = (ln: LNode): number =>
  ln.type === 'network' && ln.independentOwnerId === ln.id ? 1 : 0;

const sortSiblings = (arr: LNode[]): LNode[] =>
  arr.sort((a, b) => indepRank(a) - indepRank(b));

export function buildGraph(
  nodes: NetworkNode[],
  opts: BuildOptions,
): { rfNodes: Node[]; rfEdges: Edge[] } {
  const { collapsed, filters } = opts;
  // Con búsqueda activa ignoramos el colapso: así se revela la rama del
  // resultado aunque sus ancestros estuvieran colapsados.
  const searching = filters.search.trim().length > 0;
  const effCollapsed = searching ? new Set<string>() : collapsed;
  const real = nodes.filter((n) => !n.isSystem);
  const byId = new Map(real.map((n) => [n.id, n]));

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

  const q = filters.search.trim().toLowerCase();
  const matchName = (n: NetworkNode) =>
    q.length > 0 &&
    ((n.displayName ?? '').toLowerCase().includes(q) ||
      (n.username ?? '').toLowerCase().includes(q));

  // ── árbol completo (LNode) ─────────────────────────────────────────
  const casaRoot: LNode = {
    id: CASA_ID,
    type: 'network',
    data: {
      kind: 'casa',
      label: 'La Casa',
      roleCode: 'casa',
      status: 'active',
      descendantCount: real.length,
      isIndependent: false,
      hasChildren: true,
      collapsed: effCollapsed.has(CASA_ID),
    },
    children: [],
    independentOwnerId: null,
    filterRole: 'casa',
    status: 'active',
    inIndependent: false,
    matchesSearch: false,
    hidden: false,
    depth: 0,
    x: 0,
    y: 0,
  };

  const build = (n: NetworkNode, depth: number, indepOwner: string | null): LNode => {
    const role = displayRole(n);
    const owns = n.isIndependentBranch && role === 'socio';
    const owner = owns ? n.id : indepOwner;
    const node: LNode = {
      id: n.id,
      type: 'network',
      data: {
        kind: 'user',
        userId: n.id,
        label: n.displayName || n.username,
        username: n.username,
        roleCode: role,
        status: n.status,
        descendantCount: countDesc(n.id),
        isIndependent: !!n.isIndependentBranch,
        hasChildren: false,
        collapsed: effCollapsed.has(n.id),
      },
      children: [],
      independentOwnerId: owner,
      filterRole: role === 'admin_tenant' ? 'admin' : role,
      status: n.status,
      inIndependent: owner !== null,
      matchesSearch: matchName(n),
      hidden: false,
      depth,
      x: 0,
      y: 0,
    };
    node.children = buildKids(n, depth + 1, owner);
    (node.data as UserNodeData).hasChildren = node.children.length > 0;
    return node;
  };

  const buildKids = (parent: NetworkNode, depth: number, indepOwner: string | null): LNode[] => {
    const kids = childrenOf.get(parent.id) ?? [];
    const out: LNode[] = [];
    let playerCount = 0;
    for (const k of kids) {
      const role = displayRole(k);
      if (HIDDEN_ROLES.has(role)) continue;
      if (isPlayer(k)) {
        playerCount += 1;
        continue;
      }
      out.push(build(k, depth, indepOwner));
    }
    if (playerCount > 0) {
      out.push({
        id: `players_${parent.id}`,
        type: 'players',
        data: {
          kind: 'players',
          label: `${playerCount} ${playerCount === 1 ? 'jugador' : 'jugadores'}`,
          playerCount,
          parentUserId: parent.id,
          parentLabel: parent.displayName || parent.username,
        },
        children: [],
        independentOwnerId: indepOwner,
        filterRole: 'jugadores',
        status: 'active',
        inIndependent: indepOwner !== null,
        matchesSearch: false,
        hidden: false,
        depth,
        x: 0,
        y: 0,
      });
    }
    return sortSiblings(out);
  };

  // branchRootId aislado: solo ese subárbol cuelga de La Casa
  let displayRoots: LNode[];
  if (filters.branchRootId && byId.has(filters.branchRootId)) {
    displayRoots = [build(byId.get(filters.branchRootId)!, 1, null)];
  } else {
    displayRoots = [];
    let rootPlayers = 0;
    for (const r of roots) {
      const role = displayRole(r);
      if (HIDDEN_ROLES.has(role)) continue;
      if (isPlayer(r)) {
        rootPlayers += 1;
        continue;
      }
      displayRoots.push(build(r, 1, null));
    }
    if (rootPlayers > 0) {
      displayRoots.push({
        id: `players_${CASA_ID}`,
        type: 'players',
        data: {
          kind: 'players',
          label: `${rootPlayers} ${rootPlayers === 1 ? 'jugador' : 'jugadores'}`,
          playerCount: rootPlayers,
          parentUserId: CASA_ID,
          parentLabel: 'La Casa',
        },
        children: [],
        independentOwnerId: null,
        filterRole: 'jugadores',
        status: 'active',
        inIndependent: false,
        matchesSearch: false,
        hidden: false,
        depth: 1,
        x: 0,
        y: 0,
      });
    }
  }
  casaRoot.children = sortSiblings(displayRoots);

  // ── filtros: marcar hidden con preservación de camino ───────────────
  const passesAttr = (n: LNode): boolean => {
    if (n.filterRole === 'casa' || n.filterRole === 'admin') return true;
    if (!filters.roles.has(n.filterRole)) return false;
    if (n.type === 'network' && !filters.statuses.has(n.status)) return false;
    if (filters.independence === 'independent' && !n.inIndependent) return false;
    if (filters.independence === 'dependent' && n.inIndependent) return false;
    return true;
  };

  // search: si hay query, un nodo es "en rama" si él, un ancestro o un
  // descendiente matchea. Marcamos descendiente-de-match hacia abajo y
  // usamos matchesSearch hacia arriba.
  const hasSearch = q.length > 0;
  const markVisible = (n: LNode, ancestorMatched: boolean): boolean => {
    const selfMatch = n.matchesSearch;
    const underMatch = ancestorMatched || selfMatch;
    let anyChildVisible = false;
    for (const c of n.children) {
      if (markVisible(c, underMatch)) anyChildVisible = true;
    }
    const searchOk = !hasSearch || selfMatch || underMatch || anyChildVisible;
    const attrOk = passesAttr(n);
    // visible si (pasa atributos y search) o algún hijo visible (camino)
    const visibleSelf = attrOk && searchOk;
    n.hidden = !(visibleSelf || anyChildVisible);
    return !n.hidden;
  };
  markVisible(casaRoot, false);

  // ── layout tidy-tree horizontal (respeta collapsed y hidden) ────────
  let leafCursor = 0;
  const isCollapsed = (n: LNode) =>
    n.type === 'network' && (n.data as UserNodeData).collapsed;
  const visibleChildren = (n: LNode) =>
    isCollapsed(n) ? [] : n.children.filter((c) => !c.hidden);

  const assign = (n: LNode): void => {
    n.x = n.depth * X_GAP;
    const kids = visibleChildren(n);
    if (kids.length === 0) {
      n.y = leafCursor;
      leafCursor += Y_GAP;
      return;
    }
    for (const c of kids) assign(c);
    n.y = (kids[0]!.y + kids[kids.length - 1]!.y) / 2;
  };
  assign(casaRoot);

  // ── flatten ────────────────────────────────────────────────────────
  const rfNodes: Node[] = [];
  const rfEdges: Edge[] = [];
  const walk = (n: LNode, parentId: string | null) => {
    rfNodes.push({
      id: n.id,
      type: n.type,
      position: { x: n.x, y: n.y },
      data: n.data,
      draggable: true,
    });
    if (parentId) {
      // Aristas de una rama independiente: violeta punteado (traza la sub-red
      // sin encajonarla en un recuadro).
      const indep = n.independentOwnerId !== null;
      rfEdges.push({
        id: `e_${parentId}_${n.id}`,
        source: parentId,
        target: n.id,
        type: 'smoothstep',
        style: indep
          ? { stroke: '#A78BFA', strokeWidth: 1.8, strokeDasharray: '5 4' }
          : { stroke: 'rgba(148,163,184,0.35)', strokeWidth: 1.5 },
      });
    }
    for (const c of visibleChildren(n)) walk(c, n.id);
  };
  walk(casaRoot, null);

  return { rfNodes, rfEdges };
}

/** Lista de jugadores directos de un nodo (para el panel "N jugadores"). */
export interface PlayerRow {
  id: string;
  username: string;
  displayName: string;
  status: string;
}

export function playersOf(nodes: NetworkNode[], parentUserId: string): PlayerRow[] {
  const isCasa = parentUserId === CASA_ID;
  return nodes
    .filter((n) => {
      if (n.isSystem) return false;
      if (displayRole(n) !== 'usuario_final') return false;
      if (isCasa) return !n.parentUserId;
      return n.parentUserId === parentUserId;
    })
    .map((n) => ({
      id: n.id,
      username: n.username,
      displayName: n.displayName || n.username,
      status: n.status,
    }));
}
