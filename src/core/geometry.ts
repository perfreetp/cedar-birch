// 平面几何工具: 多边形, OBB, 采样
import type { Obstacle, Vec2 } from './types.ts'

export const EPS = 1e-9

export function polygonArea(poly: Vec2[]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i]
    const [x2, y2] = poly[(i + 1) % poly.length]
    a += x1 * y2 - x2 * y1
  }
  return a / 2
}

export function ensureCCW(poly: Vec2[]): Vec2[] {
  return polygonArea(poly) < 0 ? [...poly].reverse() : poly
}

export function pointInPolygon(x: number, y: number, poly: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + EPS) + xi) inside = !inside
  }
  return inside
}

/** 点到线段距离平方 */
export function distToSegmentSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax
  const aby = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby + EPS)))
  const dx = px - (ax + abx * t)
  const dy = py - (ay + aby * t)
  return dx * dx + dy * dy
}

/** 点到多边形边界的最小距离 (正值, 不区分内外) */
export function distToPolygonBoundary(px: number, py: number, poly: Vec2[]): number {
  let best = Infinity
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const d = distToSegmentSq(px, py, poly[j][0], poly[j][1], poly[i][0], poly[i][1])
    if (d < best) best = d
  }
  return Math.sqrt(best)
}

/** 点是否在带洞的轮廓内 */
export function pointInOutline(x: number, y: number, outer: Vec2[], holes: Vec2[][] = []): boolean {
  if (!pointInPolygon(x, y, outer)) return false
  for (const h of holes) if (pointInPolygon(x, y, h)) return false
  return true
}

/** 逆时针多边形并保证首点不重复 */
export function normalizePolygon(poly: Vec2[]): Vec2[] {
  const out: Vec2[] = []
  for (const p of poly) {
    const last = out[out.length - 1]
    if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 1e-6) out.push([p[0], p[1]])
  }
  if (out.length > 1) {
    const first = out[0]
    const last = out[out.length - 1]
    if (Math.hypot(last[0] - first[0], last[1] - first[1]) <= 1e-6) out.pop()
  }
  return ensureCCW(out)
}

/** 扫描线在多边形某一高度上的区间, 用于快速判定/采样 */
export function polygonSpanAtY(poly: Vec2[], y: number): [number, number] | null {
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y) {
      const x = ((xj - xi) * (y - yi)) / (yj - yi + EPS) + xi
      if (x < lo) lo = x
      if (x > hi) hi = x
    }
  }
  return hi > lo ? [lo, hi] : null
}

/** 按面积加权在多边形内均匀采样一个点 */
export function samplePointInPolygon(poly: Vec2[], rand: () => number = Math.random): Vec2 {
  const area = Math.abs(polygonArea(poly))
  if (area < 1e-9) {
    const minX = Math.min(...poly.map((p) => p[0]))
    const maxX = Math.max(...poly.map((p) => p[0]))
    const minY = Math.min(...poly.map((p) => p[1]))
    const maxY = Math.max(...poly.map((p) => p[1]))
    return [minX + rand() * (maxX - minX), minY + rand() * (maxY - minY)]
  }
  const minY = Math.min(...poly.map((p) => p[1]))
  const maxY = Math.max(...poly.map((p) => p[1]))
  for (let tries = 0; tries < 64; tries++) {
    const y = minY + rand() * (maxY - minY)
    const span = polygonSpanAtY(poly, y)
    if (!span) continue
    return [span[0] + rand() * (span[1] - span[0]), y]
  }
  // 兜底: 拒绝采样
  const minX = Math.min(...poly.map((p) => p[0]))
  const maxX = Math.max(...poly.map((p) => p[0]))
  for (let i = 0; i < 1000; i++) {
    const x = minX + rand() * (maxX - minX)
    const y = minY + rand() * (maxY - minY)
    if (pointInPolygon(x, y, poly)) return [x, y]
  }
  return [minX, minY]
}

export function polygonBounds(poly: Vec2[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of poly) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}

export function polygonCentroid(poly: Vec2[]): Vec2 {
  let cx = 0
  let cy = 0
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i]
    const [x2, y2] = poly[(i + 1) % poly.length]
    const cross = x1 * y2 - x2 * y1
    a += cross
    cx += (x1 + x2) * cross
    cy += (y1 + y2) * cross
  }
  a *= 0.5
  if (Math.abs(a) < 1e-9) return [...poly[0]] as Vec2
  return [cx / (6 * a), cy / (6 * a)]
}

/** 点到障碍物 (旋转矩形) 的最近点与距离 */
export function closestPointOnObstacle(o: Obstacle, px: number, pz: number): { x: number; z: number; dist: number; inside: boolean } {
  const [cx, cz] = o.center
  const c = Math.cos(-o.rotation)
  const s = Math.sin(-o.rotation)
  const dx = px - cx
  const dz = pz - cz
  // 世界 -> 本地
  const lx = dx * c - dz * s
  const lz = dx * s + dz * c
  const hx = o.size[0] / 2
  const hz = o.size[1] / 2
  const qx = Math.max(-hx, Math.min(hx, lx))
  const qz = Math.max(-hz, Math.min(hz, lz))
  const inside = Math.abs(lx) < hx && Math.abs(lz) < hz
  // 本地 -> 世界
  const c2 = Math.cos(o.rotation)
  const s2 = Math.sin(o.rotation)
  const wx = qx * c2 - qz * s2 + cx
  const wz = qx * s2 + qz * c2 + cz
  return { x: wx, z: wz, dist: Math.hypot(px - wx, pz - wz), inside }
}

export function obstacleCorners(o: Obstacle): Vec2[] {
  const [cx, cz] = o.center
  const c = Math.cos(o.rotation)
  const s = Math.sin(o.rotation)
  const hx = o.size[0] / 2
  const hz = o.size[1] / 2
  return [
    [-hx, -hz],
    [hx, -hz],
    [hx, hz],
    [-hx, hz],
  ].map(([lx, lz]) => [cx + lx * c - lz * s, cz + lx * s + lz * c] as Vec2)
}

export function obstacleAABB(o: Obstacle): { minX: number; minY: number; maxX: number; maxY: number } {
  return polygonBounds(obstacleCorners(o))
}

/** 某个点是否被障碍物实体阻挡 */
export function pointBlocked(o: Obstacle, x: number, z: number, pad = 0): boolean {
  if (!o.solid) return false
  const [cx, cz] = o.center
  const c = Math.cos(-o.rotation)
  const s = Math.sin(-o.rotation)
  const dx = x - cx
  const dz = z - cz
  const lx = dx * c - dz * s
  const lz = dx * s + dz * c
  return Math.abs(lx) <= o.size[0] / 2 + pad && Math.abs(lz) <= o.size[1] / 2 + pad
}

/** 闸机通道几何: 返回每通道的中心点(世界) 与宽度 */
export function gateLanes(o: Obstacle): { x: number; z: number; width: number; angle: number }[] {
  const n = Math.max(1, Math.round(o.gateCount ?? 1))
  const [cx, cz] = o.center
  const c = Math.cos(o.rotation)
  const s = Math.sin(o.rotation)
  const w = o.size[0]
  const laneW = w / n
  const lanes: { x: number; z: number; width: number; angle: number }[] = []
  for (let i = 0; i < n; i++) {
    const lx = -w / 2 + laneW * (i + 0.5)
    lanes.push({ x: cx + lx * c, z: cz + lx * s, width: laneW, angle: o.rotation })
  }
  return lanes
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** 确定性 RNG (mulberry32), 状态可序列化, 便于检查点回滚 */
export class Rng {
  state: number
  constructor(seed: number) {
    this.state = seed >>> 0
  }
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  clone(): Rng {
    const r = new Rng(0)
    r.state = this.state
    return r
  }
  /** 绑定为无参函数 */
  fn(): () => number {
    return () => this.next()
  }
}

export function makeRng(seed: number): () => number {
  const r = new Rng(seed)
  return r.fn()
}

export function gaussian(rand: () => number): number {
  let u = 0
  let v = 0
  while (u === 0) u = rand()
  while (v === 0) v = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/** 基于曲线控制点的分段线性插值 */
export function sampleCurve(points: Vec2[], t: number): number {
  if (points.length === 0) return 0
  if (t <= points[0][0]) return Math.max(0, points[0][1])
  for (let i = 1; i < points.length; i++) {
    const [t1, v1] = points[i]
    if (t <= t1) {
      const [t0, v0] = points[i - 1]
      if (t1 - t0 < EPS) return Math.max(0, v1)
      const k = (t - t0) / (t1 - t0)
      return Math.max(0, v0 + (v1 - v0) * k)
    }
  }
  return Math.max(0, points[points.length - 1][1])
}

/** 简化多边形 (Douglas-Peucker, 闭合) */
export function simplifyPolygon(poly: Vec2[], tol = 0.15): Vec2[] {
  if (poly.length < 5) return poly
  const pts = [...poly, poly[0]]
  const keep = new Uint8Array(pts.length)
  keep[0] = 1
  keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    let maxD = 0
    let idx = -1
    for (let i = a + 1; i < b; i++) {
      const d = distToSegmentSq(pts[i][0], pts[i][1], pts[a][0], pts[a][1], pts[b][0], pts[b][1])
      if (d > maxD) {
        maxD = d
        idx = i
      }
    }
    if (maxD > tol * tol && idx > 0) {
      keep[idx] = 1
      stack.push([a, idx], [idx, b])
    }
  }
  return pts.filter((_, i) => keep[i]).slice(0, -1)
}
