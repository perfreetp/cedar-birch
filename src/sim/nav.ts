// 导航网格 + 流场 (多汇点 Dijkstra)
import type { Obstacle, StationDoc, Vec2, Zone } from '../core/types.ts'
import { pointInOutline, distToSegmentSq, polygonBounds } from '../core/geometry.ts'
import { closestPointOnObstacle } from '../core/geometry.ts'

export interface GateLane {
  obstacleId: string
  index: number
  x: number
  z: number
  halfW: number
  halfD: number
  cos: number
  sin: number
  weight: number
  capacity: number
  /** 倍率限制器: 剩余通行名额 (人/秒 积分) */
  tokens: number
}

export interface NavGrid {
  cell: number
  cols: number
  rows: number
  originX: number
  originZ: number
  /** 0 = 可走, 1 = 阻挡; cost 为额外通行代价 */
  blocked: Uint8Array
  cost: Float32Array
  /** 每个可走格子的最近实体障碍物 id (用于承载人数统计), -1 表示无 */
  obstacleRef: Int16Array
  obstacleIds: string[]
  /** 每个格子所属功能区块 (用于进/出站判定), -1 表示无 */
  zoneRef: Int8Array
  zoneIds: string[]
  /** 每格内是否在门禁膜内, 记录闸机 lane 索引 */
  laneRef: Int16Array
  lanes: GateLane[]
  /** 每格最近的扶梯, 用于传送带加速 */
  beltRef: Int16Array
  belts: { obstacleId: string; vx: number; vz: number }[]
  sinks: { zoneId: string; cells: number[]; serviceRate: number; center: Vec2 }[]
  /** 每个 sink 的距离场 (米), Infinity = 不可达 */
  sinkDist: Float32Array[]
  sinkDirX: Float32Array[]
  sinkDirZ: Float32Array[]
  sources: { zoneId: string; cells: number[]; curveId: string; center: Vec2; weight: number }[]
  /** 每格可容纳人数 (由面积与最大密度估算) */
  cellPopCap: number
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  areaScale: number
}

const SQRT2 = Math.SQRT2

/** 构建导航网格 */
export function buildNav(doc: StationDoc): NavGrid {
  const outer = doc.outline.outer
  const b = polygonBounds(outer)
  const w = Math.max(4, b.maxX - b.minX)
  const h = Math.max(4, b.maxY - b.minY)
  const targetCols = 512
  // 保持格子接近正方形
  let cell = Math.max(0.28, Math.max(w, h) / targetCols)
  let cols = Math.ceil(w / cell) + 1
  let rows = Math.ceil(h / cell) + 1
  const maxCells = 120000
  while (cols * rows > maxCells) {
    cell *= 1.2
    cols = Math.ceil(w / cell) + 1
    rows = Math.ceil(h / cell) + 1
  }
  const originX = b.minX - cell * 0.5
  const originZ = b.minY - cell * 0.5
  const n = cols * rows
  const blocked = new Uint8Array(n)
  const cost = new Float32Array(n).fill(1)
  const obstacleRef = new Int16Array(n).fill(-1)
  const zoneRef = new Int8Array(n).fill(-1)
  const laneRef = new Int16Array(n).fill(-1)
  const beltRef = new Int16Array(n).fill(-1)

  const obstacleIds: string[] = []
  const zoneIds: string[] = []
  const lanes: GateLane[] = []
  const belts: { obstacleId: string; vx: number; vz: number }[] = []

  const holes = doc.outline.holes ?? []

  const pad = doc.params.radius * 1.05

  // 1. 轮廓
  for (let j = 0; j < rows; j++) {
    const z = originZ + (j + 0.5) * cell
    for (let i = 0; i < cols; i++) {
      const x = originX + (i + 0.5) * cell
      const k = j * cols + i
      if (!pointInOutline(x, z, outer, holes)) {
        blocked[k] = 1
        continue
      }
      // 离边界太近视为阻挡
      if (tooCloseToPolygon(x, z, outer, pad)) {
        blocked[k] = 1
        continue
      }
      for (const hole of holes) {
        if (tooCloseToPolygon(x, z, hole, pad)) {
          blocked[k] = 1
          break
        }
      }
    }
  }

  // 2. 区域
  doc.zones.forEach((zone, zi) => {
    zoneIds.push(zone.id)
    const zb = polygonBounds(zone.polygon)
    const i0 = Math.max(0, Math.floor((zb.minX - originX) / cell))
    const i1 = Math.min(cols - 1, Math.ceil((zb.maxX - originX) / cell))
    const j0 = Math.max(0, Math.floor((zb.minY - originZ) / cell))
    const j1 = Math.min(rows - 1, Math.ceil((zb.maxY - originZ) / cell))
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * cols + i
        if (blocked[k]) continue
        if (pointInZone(originX + (i + 0.5) * cell, originZ + (j + 0.5) * cell, zone)) {
          zoneRef[k] = zi
        }
      }
    }
  })

  // 3. 障碍物
  for (const o of doc.obstacles) {
    if (!o.enabled) continue
    if (!o.solid && o.kind !== 'gate' && o.kind !== 'escalator') continue
    obstacleIds.push(o.id)
    const oi = obstacleIds.length - 1
    const ab = obstacleBounds(o, pad + cell * 0.5)
    const i0 = Math.max(0, Math.floor((ab.minX - originX) / cell))
    const i1 = Math.min(cols - 1, Math.ceil((ab.maxX - originX) / cell))
    const j0 = Math.max(0, Math.floor((ab.minY - originZ) / cell))
    const j1 = Math.min(rows - 1, Math.ceil((ab.maxY - originZ) / cell))

    if (o.kind === 'gate') {
      const nLanes = Math.max(1, Math.round(o.gateCount ?? 1))
      const laneW = o.size[0] / nLanes
      const c = Math.cos(o.rotation)
      const s = Math.sin(o.rotation)
      const startLane = lanes.length
      for (let L = 0; L < nLanes; L++) {
        const lx = -o.size[0] / 2 + laneW * (L + 0.5)
        lanes.push({
          obstacleId: o.id,
          index: L,
          x: o.center[0] + lx * c,
          z: o.center[1] + lx * s,
          halfW: laneW * 0.5,
          halfD: o.size[1] * 0.5 + 0.35,
          cos: c,
          sin: s,
          weight: o.gateWeights?.[L] ?? o.weight,
          capacity: o.gateCapacities?.[L] ?? o.capacity / nLanes,
          tokens: 0,
        })
      }
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const k = j * cols + i
          if (blocked[k]) continue
          const x = originX + (i + 0.5) * cell
          const z = originZ + (j + 0.5) * cell
          // 本地坐标
          const dx = x - o.center[0]
          const dz = z - o.center[1]
          const lx = dx * c + dz * s
          const lz = -dx * s + dz * c
          if (Math.abs(lx) > o.size[0] / 2 || Math.abs(lz) > o.size[1] / 2 + 0.25) continue
          const laneIdx = Math.min(nLanes - 1, Math.max(0, Math.floor((lx + o.size[0] / 2) / laneW)))
          const lane = lanes[startLane + laneIdx]
          laneRef[k] = startLane + laneIdx
          obstacleRef[k] = oi
          // 闸门代价: 权重越低越贵
          cost[k] += (1 - Math.min(1, Math.max(0.01, lane.weight))) * 9
        }
      }
      continue
    }

    if (o.kind === 'escalator') {
      const bi = belts.length
      const c = Math.cos(o.rotation)
      const s = Math.sin(o.rotation)
      const dir = (o.beltSpeed ?? 0) >= 0 ? 1 : -1
      belts.push({ obstacleId: o.id, vx: -s * dir * Math.abs(o.beltSpeed ?? 0), vz: c * dir * Math.abs(o.beltSpeed ?? 0) })
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const k = j * cols + i
          if (blocked[k]) continue
          const x = originX + (i + 0.5) * cell
          const z = originZ + (j + 0.5) * cell
          const dx = x - o.center[0]
          const dz = z - o.center[1]
          const lx = dx * c + dz * s
          const lz = -dx * s + dz * c
          if (Math.abs(lx) > o.size[0] / 2 || Math.abs(lz) > o.size[1] / 2) continue
          beltRef[k] = bi
          obstacleRef[k] = oi
          cost[k] += (1 - Math.min(1, Math.max(0.01, o.weight))) * 3
        }
      }
      continue
    }

    if (!o.solid) continue
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * cols + i
        const x = originX + (i + 0.5) * cell
        const z = originZ + (j + 0.5) * cell
        const cp = closestPointOnObstacle(o, x, z)
        const inside = cp.inside || (Math.abs(cp.x - x) < pad && Math.abs(cp.z - z) < pad && cp.dist < pad)
        if (inside) {
          blocked[k] = 1
        } else if (cp.dist < pad + cell) {
          obstacleRef[k] = oi
          // 靠近实体障碍 → 轻微代价, 让小流场贴边但不过度
          cost[k] += 0.35
        }
      }
    }
  }

  // 4. 汇点 & 源点
  const sinks: NavGrid['sinks'] = []
  const sources: NavGrid['sources'] = []
  doc.zones.forEach((zone, zi) => {
    const cells: number[] = []
    for (let k = 0; k < n; k++) if (zoneRef[k] === zi) cells.push(k)
    if (zone.isSink && cells.length) {
      sinks.push({
        zoneId: zone.id,
        cells,
        serviceRate: zone.serviceRate ?? 8,
        center: cellsCenter(cells, cols, cell, originX, originZ),
      })
    }
    if (zone.isSource && cells.length) {
      sources.push({
        zoneId: zone.id,
        cells,
        curveId: zone.arrivalCurveId ?? doc.curves[0]?.id ?? '',
        center: cellsCenter(cells, cols, cell, originX, originZ),
        weight: zone.weight ?? 1,
      })
    }
  })

  // 无汇点时: 用进站口的对角端作为默认出口
  if (sinks.length === 0) {
    const fallback = findFallbackSink(blocked, cols, rows)
    if (fallback >= 0) {
      sinks.push({ zoneId: '__fallback__', cells: [fallback], serviceRate: 50, center: cellCenter(fallback, cols, cell, originX, originZ) })
    }
  }

  const grid: NavGrid = {
    cell,
    cols,
    rows,
    originX,
    originZ,
    blocked,
    cost,
    obstacleRef,
    obstacleIds,
    zoneRef,
    zoneIds,
    laneRef,
    lanes,
    beltRef,
    belts,
    sinks,
    sinkDist: [],
    sinkDirX: [],
    sinkDirZ: [],
    sources,
    cellPopCap: Math.max(4, Math.round((cell * cell) * 2.6)),
    bounds: b,
    areaScale: cell * cell,
  }
  computeFlowFields(grid)
  return grid
}

function tooCloseToPolygon(x: number, z: number, poly: Vec2[], pad: number): boolean {
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (distToSegmentSq(x, z, poly[j][0], poly[j][1], poly[i][0], poly[i][1]) < pad * pad) return true
  }
  return false
}

export function pointInZone(x: number, z: number, zone: Zone): boolean {
  const poly = zone.polygon
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > z !== yj > z && x < ((xj - xi) * (z - yi)) / (yj - yi + 1e-9) + xi) inside = !inside
  }
  return inside
}

function obstacleBounds(o: Obstacle, pad: number) {
  const c = Math.abs(Math.cos(o.rotation))
  const s = Math.abs(Math.sin(o.rotation))
  const hx = (o.size[0] / 2) * c + (o.size[1] / 2) * s
  const hz = (o.size[0] / 2) * s + (o.size[1] / 2) * c
  return {
    minX: o.center[0] - hx - pad,
    minY: o.center[1] - hz - pad,
    maxX: o.center[0] + hx + pad,
    maxY: o.center[1] + hz + pad,
  }
}

function cellsCenter(cells: number[], cols: number, cell: number, ox: number, oz: number): Vec2 {
  let sx = 0
  let sz = 0
  for (const k of cells) {
    const i = k % cols
    const j = (k / cols) | 0
    sx += ox + (i + 0.5) * cell
    sz += oz + (j + 0.5) * cell
  }
  return [sx / cells.length, sz / cells.length]
}

function cellCenter(k: number, cols: number, cell: number, ox: number, oz: number): Vec2 {
  const i = k % cols
  const j = (k / cols) | 0
  return [ox + (i + 0.5) * cell, oz + (j + 0.5) * cell]
}

function findFallbackSink(blocked: Uint8Array, cols: number, _rows: number): number {
  for (let k = blocked.length - 1; k >= 0; k--) if (!blocked[k] && k % cols > cols * 0.5) return k
  for (let k = 0; k < blocked.length; k++) if (!blocked[k]) return k
  return -1
}

/** 多源 Dijkstra 距离场 + 梯度方向 */
export function computeFlowFields(g: NavGrid) {
  const { cols, rows, cell, blocked, cost } = g
  const n = cols * rows
  const idx = new Int32Array(n)
  const dist = new Float64Array(n)
  const heap = new MinHeap(Math.max(1024, n))
  g.sinkDist = []
  g.sinkDirX = []
  g.sinkDirZ = []
  for (const sink of g.sinks) {
    dist.fill(Infinity)
    idx.fill(-1)
    let count = 0
    for (const k of sink.cells) {
      dist[k] = 0
      idx[count++] = k
    }
    while (heap.size > 0) heap.pop()
    for (let i = 0; i < count; i++) heap.push(dist[idx[i]], idx[i])
    while (heap.size > 0) {
      const d = heap.topKey()
      const k = heap.pop()
      if (d > dist[k]) continue
      const i = k % cols
      const j = (k / cols) | 0
      for (let dj = -1; dj <= 1; dj++) {
        const jj = j + dj
        if (jj < 0 || jj >= rows) continue
        for (let di = -1; di <= 1; di++) {
          if (di === 0 && dj === 0) continue
          const ii = i + di
          if (ii < 0 || ii >= cols) continue
          const kk = jj * cols + ii
          if (blocked[kk]) continue
          const step = (di !== 0 && dj !== 0 ? SQRT2 : 1) * cell * cost[kk]
          const nd = d + step
          if (nd < dist[kk]) {
            dist[kk] = nd
            heap.push(nd, kk)
          }
        }
      }
    }
    // 梯度方向 (指向下坡即 sink)
    const dirX = new Float32Array(n)
    const dirZ = new Float32Array(n)
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i
        if (blocked[k] || !isFinite(dist[k])) continue
        let bestD = dist[k]
        let bx = 0
        let bz = 0
        for (let dj = -1; dj <= 1; dj++) {
          const jj = j + dj
          if (jj < 0 || jj >= rows) continue
          for (let di = -1; di <= 1; di++) {
            if (di === 0 && dj === 0) continue
            const ii = i + di
            if (ii < 0 || ii >= cols) continue
            const kk = jj * cols + ii
            if (blocked[kk]) continue
            if (dist[kk] < bestD) {
              bestD = dist[kk]
              bx = di
              bz = dj
            }
          }
        }
        if (bx !== 0 || bz !== 0) {
          const len = Math.hypot(bx, bz)
          dirX[k] = bx / len
          dirZ[k] = bz / len
        }
      }
    }
    g.sinkDist.push(Float32Array.from(dist))
    g.sinkDirX.push(dirX)
    g.sinkDirZ.push(dirZ)
  }
}

export class MinHeap {
  keys: Float64Array
  vals: Int32Array
  size = 0
  constructor(cap: number) {
    this.keys = new Float64Array(cap)
    this.vals = new Int32Array(cap)
  }
  push(key: number, val: number) {
    if (this.size >= this.keys.length) this.grow()
    let i = this.size++
    const keys = this.keys
    const vals = this.vals
    keys[i] = key
    vals[i] = val
    while (i > 0) {
      const p = (i - 1) >> 1
      if (keys[p] <= keys[i]) break
      const tk = keys[p]
      keys[p] = keys[i]
      keys[i] = tk
      const tv = vals[p]
      vals[p] = vals[i]
      vals[i] = tv
      i = p
    }
  }
  topKey(): number {
    return this.keys[0]
  }
  pop(): number {
    const top = this.vals[0]
    const last = --this.size
    if (last > 0) {
      this.keys[0] = this.keys[last]
      this.vals[0] = this.vals[last]
      let i = 0
      const keys = this.keys
      const vals = this.vals
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let m = i
        if (l < this.size && keys[l] < keys[m]) m = l
        if (r < this.size && keys[r] < keys[m]) m = r
        if (m === i) break
        const tk = keys[m]
        keys[m] = keys[i]
        keys[i] = tk
        const tv = vals[m]
        vals[m] = vals[i]
        vals[i] = tv
        i = m
      }
    }
    return top
  }
  private grow() {
    const keys = new Float64Array(this.keys.length * 2)
    const vals = new Int32Array(this.vals.length * 2)
    keys.set(this.keys)
    vals.set(this.vals)
    this.keys = keys
    this.vals = vals
  }
}

export function navCellAt(g: NavGrid, x: number, z: number): number {
  const i = Math.floor((x - g.originX) / g.cell)
  const j = Math.floor((z - g.originZ) / g.cell)
  if (i < 0 || j < 0 || i >= g.cols || j >= g.rows) return -1
  return j * g.cols + i
}

export function navCellIndex(g: NavGrid, i: number, j: number): number {
  if (i < 0 || j < 0 || i >= g.cols || j >= g.rows) return -1
  return j * g.cols + i
}

export function navCellCenter(g: NavGrid, k: number): Vec2 {
  const i = k % g.cols
  const j = (k / g.cols) | 0
  return [g.originX + (i + 0.5) * g.cell, g.originZ + (j + 0.5) * g.cell]
}
