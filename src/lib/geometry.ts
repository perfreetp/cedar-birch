import type { Boundary, Pt, Rings, SeverityLevel, SeverityLevelInfo } from '../types';

export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

export function ringBounds(ring: Pt[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function boundaryBounds(b: Boundary) {
  return ringBounds(b.outer);
}

/** 有向鞋带面积：坐标平面内逆时针为正 */
export function signedArea(ring: Pt[]): number {
  let s = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function ringArea(ring: Pt[]): number {
  return Math.abs(signedArea(ring));
}

/** 平面口径：外环面积减孔洞面积 */
export function planarArea(b: Boundary): number {
  let a = ringArea(b.outer);
  for (const h of b.holes) a -= ringArea(h);
  return Math.max(0, a);
}

export function ringPerimeter(ring: Pt[]): number {
  let p = 0;
  for (let i = 0; i < ring.length; i++) p += dist(ring[i], ring[(i + 1) % ring.length]);
  return p;
}

export function boundaryPerimeter(b: Boundary): number {
  let p = ringPerimeter(b.outer);
  for (const h of b.holes) p += ringPerimeter(h);
  return p;
}

/** 射线法判断点是否在环内（边界点算在内） */
export function pointInRing(p: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x;
    const yi = ring[i].y;
    const xj = ring[j].x;
    const yj = ring[j].y;
    const intersect =
      yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function pointInBoundary(p: Pt, b: Boundary): boolean {
  if (!pointInRing(p, b.outer)) return false;
  return !b.holes.some((h) => pointInRing(p, h));
}

/** 环方向归一化：outer 逆时针（正面积），holes 顺时针（负面积） */
export function normalizeWinding(rings: Rings): Rings {
  const fix = (ring: Pt[], wantPositive: boolean): Pt[] => {
    const positive = signedArea(ring) > 0;
    return positive === wantPositive ? ring : [...ring].reverse();
  };
  return {
    outer: fix(rings.outer, true),
    holes: rings.holes.map((h) => fix(h, false)),
  };
}

/** Douglas–Peucker 抽稀（闭合环） */
export function simplifyRing(ring: Pt[], tolerance: number): Pt[] {
  if (ring.length < 4 || tolerance <= 0) return ring;
  const n = ring.length;
  const keep = new Array<boolean>(n).fill(false);
  keep[0] = true;
  keep[n - 1] = true;

  const perpDistance = (p: Pt, a: Pt, b: Pt): number => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return dist(p, a);
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  };

  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let maxD = -1;
    let idx = -1;
    for (let i = first + 1; i < last; i++) {
      const d = perpDistance(ring[i], ring[first], ring[last]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tolerance && idx > 0) {
      keep[idx] = true;
      stack.push([first, idx], [idx, last]);
    }
  }

  const out = ring.filter((_, i) => keep[i]);
  // 闭合环抽稀后首尾重合点保留一个
  if (out.length > 1 && dist(out[0], out[out.length - 1]) < 1e-9) out.pop();
  return out.length >= 3 ? out : ring.slice(0, 3);
}

/**
 * 坡度自适应加密：沿每条边按坡度调整采样步长，坡度越大步长越小。
 * slopeAt 以世界平面坐标返回坡度（弧度）；无 DEM 时返回 0。
 */
export function densifyRing(
  ring: Pt[],
  maxSpacing: number,
  slopeAt?: (p: Pt) => number,
): Pt[] {
  if (ring.length < 2) return ring.slice();
  const out: Pt[] = [];
  const minSpacing = maxSpacing / 4;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    out.push(a);
    const len = dist(a, b);
    if (len <= maxSpacing) continue;
    const mid: Pt = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const slope = slopeAt ? Math.abs(slopeAt(mid)) : 0;
    const spacing = Math.max(minSpacing, maxSpacing / (1 + 2 * slope));
    const steps = Math.max(1, Math.ceil(len / spacing));
    for (let k = 1; k < steps; k++) {
      const t = k / steps;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

/** 找到多边形（外环+孔洞）上距 p 最近的点 */
export function nearestOnBoundary(
  p: Pt,
  b: Boundary,
): { point: Pt; distance: number; ringIndex: number; edgeIndex: number } {
  let best = { point: { ...b.outer[0] }, distance: Infinity, ringIndex: 0, edgeIndex: 0 };
  const scan = (ring: Pt[], ringIndex: number) => {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const c = ring[(i + 1) % ring.length];
      const dx = c.x - a.x;
      const dy = c.y - a.y;
      const len2 = dx * dx + dy * dy;
      let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const q = { x: a.x + t * dx, y: a.y + t * dy };
      const d = dist(p, q);
      if (d < best.distance) best = { point: q, distance: d, ringIndex, edgeIndex: i };
    }
  };
  scan(b.outer, 0);
  b.holes.forEach((h, i) => scan(h, i + 1));
  return best;
}

/** 计算线段上的插值点（t 0..1） */
export function lerpPt(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** 受损分级表 */
export const SEVERITY_LEVELS: SeverityLevelInfo[] = [
  { level: 0, label: '未受损', color: 0x2e7d32, cssColor: '#2e7d32' },
  { level: 1, label: '轻度受损', color: 0xc0ca33, cssColor: '#c0ca33' },
  { level: 2, label: '中度受损', color: 0xffa726, cssColor: '#ffa726' },
  { level: 3, label: '重度受损', color: 0xef6c00, cssColor: '#ef6c00' },
  { level: 4, label: '极重受损', color: 0xb71c1c, cssColor: '#b71c1c' },
];

export function classifySeverity(index: number, cutoffs: readonly number[]): SeverityLevelInfo {
  let level: SeverityLevel = 0;
  for (let i = 0; i < cutoffs.length; i++) {
    if (index >= cutoffs[i]) level = (i + 1) as SeverityLevel;
  }
  return SEVERITY_LEVELS[level];
}

export function centroid(ring: Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p.x;
    y += p.y;
  }
  return { x: x / ring.length, y: y / ring.length };
}
