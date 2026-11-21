import { RoadNetwork, RoadEdge, RoadNode } from './types';

export interface Located {
  x: number;
  z: number;
  node: number;
}

interface NetIndex {
  adj: Map<number, { to: number; edge: RoadEdge }[]>;
  edgeMap: Map<string, RoadEdge>;
  nodeById: Map<number, RoadNode>;
}

const cache = new WeakMap<RoadNetwork, NetIndex>();

export function edgeKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

export function getIndex(net: RoadNetwork): NetIndex {
  let idx = cache.get(net);
  if (idx) return idx;
  const adj = new Map<number, { to: number; edge: RoadEdge }[]>();
  const edgeMap = new Map<string, RoadEdge>();
  const nodeById = new Map<number, RoadNode>();
  for (const n of net.nodes) nodeById.set(n.id, n);
  for (const e of net.edges) {
    if (!adj.has(e.a)) adj.set(e.a, []);
    if (!adj.has(e.b)) adj.set(e.b, []);
    adj.get(e.a)!.push({ to: e.b, edge: e });
    adj.get(e.b)!.push({ to: e.a, edge: e });
    edgeMap.set(edgeKey(e.a, e.b), e);
  }
  idx = { adj, edgeMap, nodeById };
  cache.set(net, idx);
  return idx;
}

/** Dijkstra 最短路，返回节点 id 序列；不可达返回空数组 */
export function dijkstra(net: RoadNetwork, from: number, to: number): number[] {
  const { adj } = getIndex(net);
  if (from === to) return [from];
  const dist = new Map<number, number>();
  const prev = new Map<number, number>();
  const done = new Set<number>();
  dist.set(from, 0);
  // 路网规模有限，使用简单数组优先队列
  const pq: { id: number; d: number }[] = [{ id: from, d: 0 }];
  while (pq.length) {
    let bi = 0;
    for (let i = 1; i < pq.length; i++) if (pq[i].d < pq[bi].d) bi = i;
    const { id: u, d } = pq.splice(bi, 1)[0];
    if (done.has(u)) continue;
    done.add(u);
    if (u === to) break;
    for (const { to: v, edge } of adj.get(u) ?? []) {
      if (done.has(v)) continue;
      const nd = d + edge.length;
      if (nd < (dist.get(v) ?? Infinity)) {
        dist.set(v, nd);
        prev.set(v, u);
        pq.push({ id: v, d: nd });
      }
    }
  }
  if (!prev.has(to)) return [];
  const path: number[] = [to];
  let cur = to;
  while (cur !== from) {
    cur = prev.get(cur)!;
    path.push(cur);
  }
  path.reverse();
  return path;
}

/** 边上车速：拥堵越严重越慢 */
export function speedOn(edge: RoadEdge, baseSpeed: number): number {
  return baseSpeed * Math.max(0.25, 1 - 0.7 * edge.congestion);
}

export interface PathResult {
  coords: Float32Array;
  length: number; // 米
  time: number; // 分钟
}

/**
 * 两个定位点（带最近节点）之间的最短路径折线。
 * 端点到其吸附节点之间按自由车速直线衔接，节点之间沿路网边行驶。
 */
export function buildPath(net: RoadNetwork, from: Located, to: Located, baseSpeed: number): PathResult {
  const idx = getIndex(net);
  const nodePath = dijkstra(net, from.node, to.node);
  const coords: number[] = [from.x, from.z];
  let length = 0;
  let time = 0;
  let px = from.x;
  let pz = from.z;

  if (nodePath.length === 0) {
    // 不可达：直线兜底
    const d = Math.hypot(to.x - px, to.z - pz);
    if (d > 1e-6) coords.push(to.x, to.z);
    return { coords: new Float32Array(coords), length: d, time: d / baseSpeed };
  }

  for (let i = 0; i < nodePath.length; i++) {
    const node = idx.nodeById.get(nodePath[i])!;
    const d = Math.hypot(node.x - px, node.z - pz);
    if (d > 1e-6) {
      const edge = i > 0 ? idx.edgeMap.get(edgeKey(nodePath[i - 1], nodePath[i])) : undefined;
      length += d;
      time += edge ? d / speedOn(edge, baseSpeed) : d / baseSpeed;
      coords.push(node.x, node.z);
      px = node.x;
      pz = node.z;
    }
  }
  const d = Math.hypot(to.x - px, to.z - pz);
  if (d > 1e-6) {
    length += d;
    time += d / baseSpeed;
    coords.push(to.x, to.z);
  }
  return { coords: new Float32Array(coords), length, time };
}
