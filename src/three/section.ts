// 剖切核心: 基于 three-mesh-bvh shapecast 的实时平面裁切
// 跨面三角形产生切面线段 -> 顶点焊接 -> 闭合轮廓追踪 -> earcut 三角化,
// 得到每个焊道/母材在剖切面处的真实共面填充网格与边界线
import * as THREE from 'three';
import {
  computeBoundsTree,
  disposeBoundsTree,
  acceleratedRaycast,
  MeshBVH,
} from 'three-mesh-bvh';
import earcut from 'earcut';
import { Bead } from '../types';
import { makeSectionFillMaterial } from './materials';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export interface SectionPiece {
  bead: Bead | null; // null = 母材/盖面金属
  fill: THREE.Mesh;
  edge: THREE.LineSegments;
  area: number;
}

export interface SectionBuildResult {
  group: THREE.Group;
  pieces: SectionPiece[];
}

const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

function signedDist(p: THREE.Vector3, plane: THREE.Plane): number {
  return plane.normal.dot(p) + plane.constant;
}

function segmentPlane(a: THREE.Vector3, b: THREE.Vector3, plane: THREE.Plane, target: THREE.Vector3) {
  const da = signedDist(a, plane);
  const db = signedDist(b, plane);
  const t = da / (da - db);
  target.copy(a).lerp(b, t);
}

interface EdgeSeg {
  a: THREE.Vector3;
  b: THREE.Vector3;
}

/** BVH 加速: 提取所有跨面三角形与切面的交线段 */
function collectCrossEdges(
  geometry: THREE.BufferGeometry,
  bvh: MeshBVH,
  plane: THREE.Plane,
): EdgeSeg[] {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const index = geometry.getIndex();
  const eps = 1e-7;
  const edges: EdgeSeg[] = [];

  const processTriangle = (triIndex: number) => {
    const i0 = index ? index.getX(triIndex * 3) : triIndex * 3;
    const i1 = index ? index.getX(triIndex * 3 + 1) : triIndex * 3 + 1;
    const i2 = index ? index.getX(triIndex * 3 + 2) : triIndex * 3 + 2;
    _v0.fromBufferAttribute(pos, i0);
    _v1.fromBufferAttribute(pos, i1);
    _v2.fromBufferAttribute(pos, i2);
    const d = [signedDist(_v0, plane), signedDist(_v1, plane), signedDist(_v2, plane)];
    const inside = d.map((x) => x <= eps);
    if (inside.every(Boolean) || inside.every((x) => !x)) return;

    const verts = [_v0, _v1, _v2];
    const hits: THREE.Vector3[] = [];
    for (let k = 0; k < 3; k++) {
      if (inside[k] !== inside[(k + 1) % 3]) {
        const h = new THREE.Vector3();
        segmentPlane(verts[k], verts[(k + 1) % 3], plane, h);
        hits.push(h);
      }
    }
    if (hits.length === 2) edges.push({ a: hits[0], b: hits[1] });
  };

  bvh.shapecast({
    intersectsBounds: (box) => {
      const n = plane.normal;
      const center = new THREE.Vector3();
      box.getCenter(center);
      const size = new THREE.Vector3();
      box.getSize(size);
      const r =
        Math.abs(n.x) * size.x * 0.5 +
        Math.abs(n.y) * size.y * 0.5 +
        Math.abs(n.z) * size.z * 0.5;
      const dCenter = n.dot(center) + plane.constant;
      return dCenter - r <= eps && dCenter + r >= -eps;
    },
    intersectsRange: () => false,
    intersectsTriangle: (_tri, triIndex) => {
      processTriangle(triIndex);
      return false;
    },
  });
  return edges;
}

const WELD_EPS = 1e-4;

/** 诊断信息(测试用): 记录最近一次各源剖切的中间统计 */
export const clipDiagnostics: Array<{
  name: string;
  edges: number;
  weldedPoints: number;
  loops: number[];
  producedCap: boolean;
}> = [];

/** 每次剖切前清空诊断, 保证数组只反映最近一次剖切 */
export function resetClipDiagnostics() {
  clipDiagnostics.length = 0;
}

/** 顶点焊接: 近邻(切平面内 2D 距离)合并 */
function weldVertices(edges: EdgeSeg[]): { points: THREE.Vector3[]; pairs: [number, number][] } {
  const points: THREE.Vector3[] = [];
  const findOrAdd = (p: THREE.Vector3): number => {
    for (let i = 0; i < points.length; i++) {
      if (points[i].distanceToSquared(p) < WELD_EPS * WELD_EPS) return i;
    }
    points.push(p.clone());
    return points.length - 1;
  };
  const pairs: [number, number][] = edges.map((e) => [findOrAdd(e.a), findOrAdd(e.b)]);
  return { points, pairs };
}

/** 无向边表 -> 闭合轮廓(每个顶点恰有两条边),带严格迭代上限防死循环 */
function traceLoops(pairs: [number, number][]): number[][] {
  const adjacency = new Map<number, number[]>();
  const edgeKey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  const unused = new Set<string>();
  for (const [a, b] of pairs) {
    if (a === b) continue;
    if (!adjacency.has(a)) adjacency.set(a, []);
    if (!adjacency.has(b)) adjacency.set(b, []);
    adjacency.get(a)!.push(b);
    adjacency.get(b)!.push(a);
    unused.add(edgeKey(a, b));
  }

  const loops: number[][] = [];
  const maxSteps = pairs.length * 2 + 4;
  for (const start of adjacency.keys()) {
    // 该起点还连着未用边才开始新环
    const hasUnused = adjacency.get(start)!.some((n) => unused.has(edgeKey(start, n)));
    if (!hasUnused) continue;

    const loop: number[] = [start];
    let prev = -1;
    let cur = start;
    let closed = false;
    for (let steps = 0; steps < maxSteps; steps++) {
      const next = adjacency
        .get(cur)!
        .find((n) => n !== prev && unused.has(edgeKey(cur, n)));
      if (next === undefined) break;
      unused.delete(edgeKey(cur, next));
      if (next === start) {
        closed = true;
        break;
      }
      loop.push(next);
      prev = cur;
      cur = next;
    }
    if (closed && loop.length >= 3) loops.push(loop);
  }
  return loops;
}

function signedArea2D(loop: THREE.Vector3[], u: THREE.Vector3, v: THREE.Vector3): number {
  let s = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    const ax = a.dot(u);
    const ay = a.dot(v);
    const bx = b.dot(u);
    const by = b.dot(v);
    s += ax * by - bx * ay;
  }
  return s * 0.5;
}

/**
 * 把切面边段重建为共面三角网格。
 * 输出: position 数组(三维)与面积(平面内 mm²)。
 */
function buildCapFromEdges(edges: EdgeSeg[], plane: THREE.Plane): { positions: number[]; area: number } | null {
  if (edges.length < 3) return null;
  const { points, pairs } = weldVertices(edges);
  if (points.length < 3) return null;
  const loops = traceLoops(pairs);
  if (loops.length === 0) return null;

  // 切平面正交基: u/v 张成平面, normal 为面法向
  const n = plane.normal;
  const ref = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(ref, n).normalize();
  const v = new THREE.Vector3().crossVectors(n, u).normalize();

  // 外环 = 面积绝对值最大的环; 其余为孔
  let outerIdx = 0;
  let outerArea = 0;
  const loopAreas = loops.map((loop) => {
    const poly = loop.map((i) => points[i]);
    return signedArea2D(poly, u, v);
  });
  loops.forEach((_, i) => {
    if (Math.abs(loopAreas[i]) > outerArea) {
      outerArea = Math.abs(loopAreas[i]);
      outerIdx = i;
    }
  });

  const dims: number[] = [];
  const holes: number[] = [];
  const indexMap: number[] = []; // earcut 顶点序号 -> points 原始序号
  const emitLoop = (loop: number[], isOuter: boolean) => {
    // 退化环(顶点去重后不足 3 个)无法参与三角化,丢弃
    const unique = [...new Set(loop)];
    if (unique.length < 3) return;
    let order = loop.slice();
    const poly = order.map((i) => points[i]);
    // earcut 要求外环 CCW、孔 CW(在 u-v 坐标系中)
    const area = signedArea2D(poly, u, v);
    const needCCW = isOuter;
    if ((needCCW && area < 0) || (!needCCW && area > 0)) order = order.slice().reverse();
    for (const pointIdx of order) {
      const p = points[pointIdx];
      dims.push(p.dot(u), p.dot(v));
      indexMap.push(pointIdx);
    }
    if (!isOuter) holes.push(dims.length / 2);
  };
  emitLoop(loops[outerIdx], true);
  loops.forEach((loop, i) => {
    if (i !== outerIdx) emitLoop(loop, false);
  });

  const tri2d = safeEarcut(dims, holes);
  if (tri2d.length === 0) return null;
  const positions: number[] = [];
  for (const idx2d of tri2d) {
    const p = points[indexMap[idx2d]];
    positions.push(p.x, p.y, p.z);
  }
  return { positions, area: outerArea };
}

/** earcut 可能因孔洞拓扑退化抛错,失败时退化为仅外环(保证剖切不中断) */
function safeEarcut(dims: number[], holes: number[]): number[] {
  try {
    const tris = earcut(dims, holes, 2);
    if (tris.length > 0) return tris;
  } catch {
    /* 退化拓扑,回退到无孔三角化 */
  }
  if (holes.length > 0) {
    const outerEnd = holes[0];
    const outerDims = dims.slice(0, outerEnd * 2);
    try {
      return earcut(outerDims, [], 2);
    } catch {
      return [];
    }
  }
  return [];
}

function clipGeometryToPlane(
  geometry: THREE.BufferGeometry,
  bvh: MeshBVH,
  plane: THREE.Plane,
  name = 'unknown',
): { geo: THREE.BufferGeometry; area: number } | null {
  const edges = collectCrossEdges(geometry, bvh, plane);
  const cap = buildCapFromEdges(edges, plane);
  clipDiagnostics.push({
    name,
    edges: edges.length,
    weldedPoints: cap ? 0 : 0,
    loops: cap ? [0] : [],
    producedCap: cap !== null,
  });
  if (edges.length >= 3 && cap) {
    const { points, pairs } = weldVertices(edges);
    const loops = traceLoops(pairs);
    const last = clipDiagnostics[clipDiagnostics.length - 1];
    last.weldedPoints = points.length;
    last.loops = loops.map((l) => l.length);
  }
  if (clipDiagnostics.length > 200) clipDiagnostics.shift();
  if (!cap) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(cap.positions, 3));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return { geo, area: Math.abs(cap.area) };
}

export interface ClipSource {
  mesh: THREE.Mesh;
  bvh: MeshBVH;
  bead: Bead | null;
  baseColor: number;
}

export function buildSection(
  sources: ClipSource[],
  plane: THREE.Plane,
  thermalColorFor: (bead: Bead) => number | null,
  highlightId: string | null,
): SectionBuildResult {
  const group = new THREE.Group();
  group.name = 'section-group';
  const pieces: SectionPiece[] = [];
  resetClipDiagnostics();

  for (const src of sources) {
    let clipped: { geo: THREE.BufferGeometry; area: number } | null = null;
    try {
      clipped = clipGeometryToPlane(src.mesh.geometry, src.bvh, plane, src.bead?.id ?? 'metal');
    } catch {
      clipped = null; // 单个源剖切失败不应影响其他源与整体响应式链路
    }
    if (!clipped) continue;

    let color = src.baseColor;
    if (src.bead) {
      const thermal = thermalColorFor(src.bead);
      if (thermal !== null) color = thermal;
      if (src.bead.id === highlightId) color = 0xffd63d;
    }
    const fillMat = makeSectionFillMaterial(color, src.bead !== null);
    const fill = new THREE.Mesh(clipped.geo, fillMat);
    fill.renderOrder = src.bead !== null ? 3 : 2;
    fill.userData.beadId = src.bead ? src.bead.id : null;

    const edges = new THREE.EdgesGeometry(clipped.geo, 25);
    const line = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({
        color: src.bead ? 0x1c2430 : 0x0d0f14,
        transparent: true,
        opacity: 0.85,
      }),
    );
    line.renderOrder = 3;
    (line.material as THREE.LineBasicMaterial).clippingPlanes = [];

    group.add(fill, line);
    pieces.push({ bead: src.bead, fill, edge: line, area: clipped.area });
  }

  return { group, pieces };
}

export function disposeSection(result: SectionBuildResult | null) {
  if (!result) return;
  for (const p of result.pieces) {
    p.fill.geometry.dispose();
    (p.fill.material as THREE.Material).dispose();
    p.edge.geometry.dispose();
    (p.edge.material as THREE.Material).dispose();
  }
  result.group.clear();
}

/** 名义坡口壁在剖面上的投影线(展示熔深: 焊道相对名义壁外扩) */
export function buildGrooveWallLines(nominalCW: { x: number; y: number }[], z: number) {
  const pts = nominalCW.map((p) => new THREE.Vector3(p.x, p.y, z + 0.06));
  pts.push(pts[0].clone());
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineDashedMaterial({
    color: 0xffe28a,
    dashSize: 1.4,
    gapSize: 0.9,
    transparent: true,
    opacity: 0.9,
  });
  mat.clippingPlanes = [];
  const line = new THREE.Line(geo, mat);
  line.computeLineDistances();
  line.renderOrder = 4;
  return line;
}
