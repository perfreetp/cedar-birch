import { Building, CollectionPoint, RoadEdge, RoadNetwork, RoadNode } from './types';
import { getIndex } from './network';

/** 生成演示路网：网格城市，随机删边（保持连通），随机拥堵度，街区生成建筑 */
export function generateDemoNetwork(
  gridN = 12,
  spacing = 60,
): { network: RoadNetwork; buildings: Building[] } {
  const nodes: RoadNode[] = [];
  const off = ((gridN - 1) * spacing) / 2;
  for (let i = 0; i < gridN; i++) {
    for (let j = 0; j < gridN; j++) {
      nodes.push({ id: i * gridN + j, x: j * spacing - off, z: i * spacing - off });
    }
  }
  const nid = (i: number, j: number) => i * gridN + j;
  const edges: RoadEdge[] = [];
  let eid = 0;
  const candidates: [number, number][] = [];
  for (let i = 0; i < gridN; i++) {
    for (let j = 0; j < gridN; j++) {
      if (j + 1 < gridN) candidates.push([nid(i, j), nid(i, j + 1)]);
      if (i + 1 < gridN) candidates.push([nid(i, j), nid(i + 1, j)]);
    }
  }
  const removed: [number, number][] = [];
  for (const [a, b] of candidates) {
    if (Math.random() < 0.1 && edges.length > gridN * 2) {
      removed.push([a, b]);
      continue;
    }
    edges.push(makeEdge(eid++, a, b, nodes));
  }
  // 保证连通：若删边后不连通则逐一加回
  const isConnected = () => {
    const net: RoadNetwork = { nodes, edges };
    const { adj } = getIndex(net);
    const seen = new Set<number>([0]);
    const q = [0];
    while (q.length) {
      const u = q.pop()!;
      for (const { to } of adj.get(u) ?? []) {
        if (!seen.has(to)) {
          seen.add(to);
          q.push(to);
        }
      }
    }
    return seen.size === nodes.length;
  };
  for (const [a, b] of removed) {
    if (isConnected()) break;
    edges.push(makeEdge(eid++, a, b, nodes));
  }

  // 建筑：街区中心随机生成
  const buildings: Building[] = [];
  for (let i = 0; i < gridN - 1; i++) {
    for (let j = 0; j < gridN - 1; j++) {
      if (Math.random() < 0.55) {
        buildings.push({
          x: (j + 0.5) * spacing - off + (Math.random() - 0.5) * 8,
          z: (i + 0.5) * spacing - off + (Math.random() - 0.5) * 8,
          w: spacing * (0.3 + Math.random() * 0.2),
          d: spacing * (0.3 + Math.random() * 0.2),
          h: 8 + Math.random() * 32,
        });
      }
    }
  }
  return { network: { nodes, edges }, buildings };
}

function makeEdge(id: number, a: number, b: number, nodes: { id: number; x: number; z: number }[]): RoadEdge {
  const na = nodes[a];
  const nb = nodes[b];
  const avenue = na.x === nb.x ? na.x % 240 === 0 : na.z % 240 === 0;
  return {
    id,
    a,
    b,
    length: Math.hypot(nb.x - na.x, nb.z - na.z),
    congestion: Math.random() < 0.35 ? Math.random() * 0.3 : 0.2 + Math.random() * 0.8,
    width: avenue ? 11 : 7,
  };
}

/** 在路网上随机生成收运点位 */
export function generatePoints(net: RoadNetwork, count: number): CollectionPoint[] {
  const { nodeById } = getIndex(net);
  const pts: CollectionPoint[] = [];
  if (net.edges.length === 0) return pts;
  for (let i = 0; i < count; i++) {
    const e = net.edges[Math.floor(Math.random() * net.edges.length)];
    const na = nodeById.get(e.a)!;
    const nb = nodeById.get(e.b)!;
    const t = 0.15 + Math.random() * 0.7;
    const x = na.x + (nb.x - na.x) * t;
    const z = na.z + (nb.z - na.z) * t;
    // 垂直偏移到路边
    const dx = nb.x - na.x;
    const dz = nb.z - na.z;
    const len = Math.hypot(dx, dz) || 1;
    const side = Math.random() < 0.5 ? 1 : -1;
    const off = (e.width / 2 + 2.5) * side;
    const px = (-dz / len) * off;
    const pz = (dx / len) * off;
    const da = Math.hypot(x - na.x, z - na.z);
    const db = Math.hypot(x - nb.x, z - nb.z);
    pts.push({
      id: i,
      x: x + px,
      z: z + pz,
      edgeId: e.id,
      node: da < db ? e.a : e.b,
      amount: Math.round(5 + 95 * Math.pow(Math.random(), 2)),
      weight: 1,
    });
  }
  return pts;
}

/** 场站取路网质心最近节点 */
export function pickDepot(net: RoadNetwork): { x: number; z: number; node: number } {
  if (net.nodes.length === 0) return { x: 0, z: 0, node: 0 };
  let cx = 0;
  let cz = 0;
  for (const n of net.nodes) {
    cx += n.x;
    cz += n.z;
  }
  cx /= net.nodes.length;
  cz /= net.nodes.length;
  let best = net.nodes[0];
  let bd = Infinity;
  for (const n of net.nodes) {
    const d = Math.hypot(n.x - cx, n.z - cz);
    if (d < bd) {
      bd = d;
      best = n;
    }
  }
  return { x: best.x, z: best.z, node: best.id };
}
