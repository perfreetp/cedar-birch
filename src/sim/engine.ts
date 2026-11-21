// 客流仿真引擎
//  - 行人: SoA 结构, 最多 20000+ 同时在場
//  - 引导: 多汇点 Dijkstra 流场 (双线性插值) + 社会力排斥 + BVH 射线避让
//  - 限流: 闸机通道权重 / 最大承载人数, 障碍物承载人数
//  - 栅格化: 512x512 物理密度纹理
import type { StationDoc, Vec2, Zone } from '../core/types.ts'
import { buildNav, computeFlowFields, navCellAt, navCellCenter, type NavGrid } from './nav.ts'
import { SpatialHash } from './spatial.ts'
import { ObstacleBVH } from './avoid.ts'
import { DensityRasterizer } from './density.ts'
import { clamp, gaussian, Rng, sampleCurve } from '../core/geometry.ts'

export interface AgentExport {
  count: number
  x: Float32Array
  z: Float32Array
  heading: Float32Array
  phase: Float32Array
  state: Uint8Array
}

export interface FrameStats {
  time: number
  occupancy: number
  meanSpeed: number
  maxDensity: number
  bandCounts: number[]
  served: number
  waitingAtGates: number
  spill: number
  meanDensity: number
}

export const MAX_ACTIVE = 26000

export interface Checkpoint {
  frame: number
  time: number
  rngState: number
  n: number
  x: Float32Array
  z: Float32Array
  vx: Float32Array
  vz: Float32Array
  sink: Int16Array
  speed: Float32Array
  phase: Float32Array
  served: number
  spill: number
  spawnAcc: Float64Array
  sinkTokens: Float64Array
  stepCount: number
  nextCheckpointStep: number
  dt: number
}

const PROBE_ANGLES = [-1.22, -0.92, -0.62, -0.31, 0, 0.31, 0.62, 0.92, 1.22]

export class SimEngine {
  doc: StationDoc
  nav: NavGrid
  bvh: ObstacleBVH
  hash: SpatialHash
  raster: DensityRasterizer

  x = new Float32Array(MAX_ACTIVE)
  z = new Float32Array(MAX_ACTIVE)
  vx = new Float32Array(MAX_ACTIVE)
  vz = new Float32Array(MAX_ACTIVE)
  speed = new Float32Array(MAX_ACTIVE)
  sink = new Int16Array(MAX_ACTIVE)
  phase = new Float32Array(MAX_ACTIVE)
  state = new Uint8Array(MAX_ACTIVE)
  stall = new Float32Array(MAX_ACTIVE)
  n = 0

  rng: Rng
  seed: number
  time = 0
  frame = 0
  served = 0
  spill = 0
  spawnAcc: Float64Array
  sinkTokens: Float64Array
  checkpoints: Checkpoint[] = []
  /** 回放中修改闸机权重的事件, 用于导出与时间轴标记 */
  gateEvents: { time: number; obstacleId: string; label: string; changes: string }[] = []
  private nextCheckpointStep = 0

  private navPop: Int32Array
  private densityGrid: Float32Array
  private tmpGrid: Float32Array
  private obstaclePop: Int32Array
  private lanePop: Int32Array
  private nearObstacle: Uint8Array
  private obstacleCap: Float32Array
  private zoneSink: Int16Array
  private stepCount = 0
  separationIters = 2
  private tmpOut: Uint8Array
  dtAtCheckpoint = 0

  constructor(doc: StationDoc, seed = 12345) {
    this.doc = doc
    this.seed = seed
    this.rng = new Rng(seed)
    this.nav = buildNav(doc)
    this.bvh = new ObstacleBVH()
    this.bvh.build(doc.obstacles)
    const g = this.nav
    this.hash = new SpatialHash(g.bounds.minX - 2, g.bounds.minY - 2, g.bounds.maxX + 2, g.bounds.maxY + 2, 0.9)
    const cells = g.cols * g.rows
    this.navPop = new Int32Array(cells)
    this.densityGrid = new Float32Array(cells)
    this.tmpGrid = new Float32Array(cells)
    this.obstaclePop = new Int32Array(Math.max(1, g.obstacleIds.length))
    this.lanePop = new Int32Array(Math.max(1, g.lanes.length))
    this.nearObstacle = new Uint8Array(cells)
    for (let k = 0; k < cells; k++) if (!g.blocked[k] && g.cost[k] > 1.02) this.nearObstacle[k] = 1
    this.obstacleCap = new Float32Array(Math.max(1, g.obstacleIds.length))
    for (let i = 0; i < g.obstacleIds.length; i++) {
      const o = doc.obstacles.find((x) => x.id === g.obstacleIds[i])
      this.obstacleCap[i] = o?.capacity ?? 0
    }
    this.spawnAcc = new Float64Array(Math.max(1, g.sources.length))
    this.sinkTokens = new Float64Array(Math.max(1, g.sinks.length))
    this.zoneSink = new Int16Array(g.zoneIds.length).fill(-1)
    g.sinks.forEach((s, i) => {
      const zi = g.zoneIds.indexOf(s.zoneId)
      if (zi >= 0) this.zoneSink[zi] = i
    })
    this.raster = new DensityRasterizer(doc.params.gridSize, g.bounds.minX, g.bounds.minY, g.bounds.maxX, g.bounds.maxY)
    this.tmpOut = new Uint8Array(doc.params.gridSize * doc.params.gridSize)
    this.makeCheckpoint(0, 0)
  }

  reset(seed = this.seed) {
    this.seed = seed
    this.rng = new Rng(seed)
    this.n = 0
    this.time = 0
    this.frame = 0
    this.served = 0
    this.spill = 0
    this.spawnAcc.fill(0)
    this.sinkTokens.fill(0)
    this.checkpoints = []
    this.nextCheckpointStep = 0
    this.stepCount = 0
    this.makeCheckpoint(0, 0)
  }

  /** 重建几何 (轮廓/区块/障碍物变化后调用) */
  rebuild(doc: StationDoc = this.doc) {
    this.doc = doc
    this.nav = buildNav(doc)
    this.bvh.build(doc.obstacles)
    const g = this.nav
    const cells = g.cols * g.rows
    this.navPop = new Int32Array(cells)
    this.densityGrid = new Float32Array(cells)
    this.tmpGrid = new Float32Array(cells)
    this.obstaclePop = new Int32Array(Math.max(1, g.obstacleIds.length))
    this.lanePop = new Int32Array(Math.max(1, g.lanes.length))
    this.nearObstacle = new Uint8Array(cells)
    for (let k = 0; k < cells; k++) if (!g.blocked[k] && g.cost[k] > 1.02) this.nearObstacle[k] = 1
    this.obstacleCap = new Float32Array(Math.max(1, g.obstacleIds.length))
    for (let i = 0; i < g.obstacleIds.length; i++) {
      const o = doc.obstacles.find((x) => x.id === g.obstacleIds[i])
      this.obstacleCap[i] = o?.capacity ?? 0
    }
    this.hash = new SpatialHash(g.bounds.minX - 2, g.bounds.minY - 2, g.bounds.maxX + 2, g.bounds.maxY + 2, 0.9)
    const oldSpawn = this.spawnAcc
    this.spawnAcc = new Float64Array(Math.max(1, g.sources.length))
    this.spawnAcc.set(oldSpawn.subarray(0, Math.min(oldSpawn.length, this.spawnAcc.length)))
    const oldTok = this.sinkTokens
    this.sinkTokens = new Float64Array(Math.max(1, g.sinks.length))
    this.sinkTokens.set(oldTok.subarray(0, Math.min(oldTok.length, this.sinkTokens.length)))
    this.zoneSink = new Int16Array(g.zoneIds.length).fill(-1)
    g.sinks.forEach((s, i) => {
      const zi = g.zoneIds.indexOf(s.zoneId)
      if (zi >= 0) this.zoneSink[zi] = i
    })
    for (let i = 0; i < this.n; i++) if (this.sink[i] >= g.sinks.length) this.sink[i] = 0
    this.raster = new DensityRasterizer(doc.params.gridSize, g.bounds.minX, g.bounds.minY, g.bounds.maxX, g.bounds.maxY)
    this.tmpOut = new Uint8Array(doc.params.gridSize * doc.params.gridSize)
  }

  /** 仅更新闸机权重/承载人数, 重建流场, 保留行人状态 */
  updateGateWeights(changes: { obstacleId: string; laneIndex?: number; weight?: number; capacity?: number }[]) {
    const desc = changes
      .map((c) => {
        const o = this.doc.obstacles.find((x) => x.id === c.obstacleId)
        const name = o?.name ?? c.obstacleId
        if (c.laneIndex === undefined) return `${name} 权重→${c.weight?.toFixed(2)}`
        return `${name}#${c.laneIndex + 1} 权重→${c.weight?.toFixed(2)}`
      })
      .join('; ')
    this.gateEvents.push({ time: this.time, obstacleId: changes[0]?.obstacleId ?? '', label: '闸机权重变更', changes: desc })
    for (const c of changes) {
      const o = this.doc.obstacles.find((x) => x.id === c.obstacleId)
      if (!o) continue
      const laneN = Math.max(1, Math.round(o.gateCount ?? 1))
      if (c.laneIndex === undefined) {
        if (c.weight !== undefined) o.weight = c.weight
        if (c.capacity !== undefined) o.capacity = c.capacity
        o.gateWeights = undefined
        o.gateCapacities = undefined
      } else {
        if (c.weight !== undefined) {
          const gw = o.gateWeights ? [...o.gateWeights] : new Array(laneN).fill(o.weight)
          gw[c.laneIndex] = c.weight
          o.gateWeights = gw
        }
        if (c.capacity !== undefined) {
          const gc = o.gateCapacities ? [...o.gateCapacities] : new Array(laneN).fill(o.capacity / laneN)
          gc[c.laneIndex] = c.capacity
          o.gateCapacities = gc
        }
      }
    }
    const g = this.nav
    for (const lane of g.lanes) {
      const o = this.doc.obstacles.find((x) => x.id === lane.obstacleId)
      if (!o) continue
      const laneN = Math.max(1, Math.round(o.gateCount ?? 1))
      lane.weight = o.gateWeights?.[lane.index] ?? o.weight
      lane.capacity = o.gateCapacities?.[lane.index] ?? o.capacity / laneN
    }
    const { cols, rows, cost, blocked, laneRef, lanes } = g
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i
        if (blocked[k]) continue
        const li = laneRef[k]
        if (li >= 0) cost[k] = 1 + (1 - clamp(lanes[li].weight, 0.01, 1)) * 9
      }
    }
    computeFlowFields(g)
  }

  step(dt: number) {
    const p = this.doc.params
    const nav = this.nav
    this.stepCount++
    this.time = this.stepCount * dt
    const rng = this.rng
    const rnd = rng.next.bind(rng)
    const n0 = this.n

    this.hash.build(this.x, this.z, n0)

    const navPop = this.navPop
    navPop.fill(0)
    const obstaclePop = this.obstaclePop
    obstaclePop.fill(0)
    const lanePop = this.lanePop
    lanePop.fill(0)
    const cols = nav.cols
    const rows = nav.rows
    const blocked = nav.blocked
    const navOriginX = nav.originX
    const navOriginZ = nav.originZ
    const cellSize = nav.cell
    for (let i = 0; i < n0; i++) {
      const k = navCellAt(nav, this.x[i], this.z[i])
      if (k < 0) continue
      navPop[k]++
      const oi = nav.obstacleRef[k]
      if (oi >= 0) obstaclePop[oi]++
      const li = nav.laneRef[k]
      if (li >= 0) lanePop[li]++
    }
    // 平滑密度: 可分离盒式模糊 (O(N)), 近似 7x7 邻域 (约 2m×2m)
    const densityGrid = this.densityGrid
    const tmpGrid = this.tmpGrid
    const R = 3
    const invW = 1 / (2 * R + 1)
    // 横向
    for (let j = 0; j < rows; j++) {
      const off = j * cols
      let sum = 0
      for (let i = -R; i <= R; i++) sum += navPop[off + Math.min(cols - 1, Math.max(0, i))]
      for (let i = 0; i < cols; i++) {
        tmpGrid[off + i] = sum * invW
        sum += navPop[off + Math.min(cols - 1, i + R + 1)] - navPop[off + Math.max(0, i - R)]
      }
    }
    // 纵向
    const invArea = 1 / (nav.cell * nav.cell)
    for (let i = 0; i < cols; i++) {
      let sum = 0
      for (let j = -R; j <= R; j++) sum += tmpGrid[Math.min(rows - 1, Math.max(0, j)) * cols + i]
      for (let j = 0; j < rows; j++) {
        const k = j * cols + i
        densityGrid[k] = blocked[k] ? 0 : sum * invW * invArea
        sum += tmpGrid[Math.min(rows - 1, j + R + 1) * cols + i] - tmpGrid[Math.max(0, j - R) * cols + i]
      }
    }

    // 投放
    const sources = nav.sources
    const maxPop = Math.min(p.maxPeople, MAX_ACTIVE)
    for (let s = 0; s < sources.length; s++) {
      const src = sources[s]
      const curve = this.doc.curves.find((c) => c.id === src.curveId) ?? this.doc.curves[0]
      const rate = curve ? sampleCurve(curve.points, this.time) * src.weight : 0
      this.spawnAcc[s] += rate * dt
      let guard = 0
      while (this.spawnAcc[s] >= 1 && guard++ < 5000) {
        this.spawnAcc[s] -= 1
        if (this.n >= maxPop) {
          this.spill++
          continue
        }
        this.spawnAgent(src.cells, rnd)
      }
    }

    // 个体更新
    const repRange = p.repulsionRange
    const repStrength = p.repulsion
    const radius = p.radius
    const rayDist = p.rayAvoidDist
    const lanes = nav.lanes
    const sinkDirX = nav.sinkDirX
    const sinkDirZ = nav.sinkDirZ
    const laneRef = nav.laneRef
    const obstacleRef = nav.obstacleRef
    const beltRef = nav.beltRef
    const belts = nav.belts
    const zoneRef = nav.zoneRef
    const zoneSink = this.zoneSink
    const sinkTokens = this.sinkTokens
    const sinks = nav.sinks
    const nearObstacle = this.nearObstacle
    const obstacleCap = this.obstacleCap
    const hash = this.hash
    const hStart = hash.start
    const hItems = hash.items
    const hCols = hash.cols
    const hRows = hash.rows
    const hCell = hash.cellSize
    const hMinX = hash.minX
    const hMinZ = hash.minZ
    const x = this.x
    const z = this.z
    const vx = this.vx
    const vz = this.vz
    const speed = this.speed
    const sinkIdxArr = this.sink
    const phase = this.phase
    const stall = this.stall
    const nSink = sinkDirX.length
    // 只处理物理上会挤在一起的行人 (强排斥), 弱排斥交给流场与密度减速
    const overlapDist = Math.min(radius * 2 + 0.55, repRange)
    const overlapR2 = overlapDist * overlapDist
    const repQuery = Math.max(repRange, overlapDist)
    const probeMod = this.stepCount & 3
    const sepIters = this.separationIters
    const forceSep = this.n < 6000

    for (let i = 0; i < this.n; i++) {
      const xi = x[i]
      const zi = z[i]
      let c = navCellAt(nav, xi, zi)
      const si = sinkIdxArr[i] < nSink ? sinkIdxArr[i] : 0

      let fx = 0
      let fz = 0
      if (c >= 0) {
        const gx = (xi - navOriginX) / cellSize - 0.5
        const gz = (zi - navOriginZ) / cellSize - 0.5
        const i0 = Math.floor(gx)
        const j0 = Math.floor(gz)
        const tx = gx - i0
        const tz = gz - j0
        const dxs = sinkDirX[si]
        const dzs = sinkDirZ[si]
        let sx = 0
        let sz = 0
        let wsum = 0
        for (let dj = 0; dj <= 1; dj++) {
          const jj = j0 + dj
          if (jj < 0 || jj >= rows) continue
          const rowOff = jj * cols
          for (let di = 0; di <= 1; di++) {
            const ii = i0 + di
            if (ii < 0 || ii >= cols) continue
            const kk = rowOff + ii
            if (blocked[kk]) continue
            const w = (di === 0 ? 1 - tx : tx) * (dj === 0 ? 1 - tz : tz)
            sx += dxs[kk] * w
            sz += dzs[kk] * w
            wsum += w
          }
        }
        if (wsum > 1e-6) {
          fx = sx / wsum
          fz = sz / wsum
        }
        if (Math.abs(fx) + Math.abs(fz) < 1e-4) {
          fx = dxs[c]
          fz = dzs[c]
        }
      }
      let flen = Math.sqrt(fx * fx + fz * fz)
      if (flen < 1e-4) {
        const a = rnd() * Math.PI * 2
        fx = Math.cos(a) * 0.4
        fz = Math.sin(a) * 0.4
        flen = 0.4
      }
      fx /= flen
      fz /= flen

      const localDensityEstimate = c >= 0 ? this.densityGrid[c] : 0
      // 邻居斥力: 只处理真正重叠的邻居 (接触力), 成对对称施加并限幅.
      // 早期版本按"相对速度"放大斥力, 在密集人群中会形成反冲正反馈导致死锁,
      // 这里改为纯接触弹簧力: 重叠越深推力越大, 但总量封顶, 保证人群可以蠕动而不是炸开.
      let rx = 0
      let rz = 0
      if (hash.cellOf(xi, zi) >= 0) {
        const ri0 = Math.max(0, Math.floor((xi - repQuery - hMinX) / hCell))
        const ri1 = Math.min(hCols - 1, Math.floor((xi + repQuery - hMinX) / hCell))
        const rj0 = Math.max(0, Math.floor((zi - repQuery - hMinZ) / hCell))
        const rj1 = Math.min(hRows - 1, Math.floor((zi + repQuery - hMinZ) / hCell))
        const repBudget = localDensityEstimate > 2 ? (localDensityEstimate > 5 ? 4 : 8) : 20
        let budget = repBudget
        for (let jj = rj0; jj <= rj1 && budget > 0; jj++) {
          const rowOff = jj * hCols
          for (let ii = ri0; ii <= ri1 && budget > 0; ii++) {
            const kk = rowOff + ii
            const e0 = hStart[kk + 1]
            for (let t = hStart[kk]; t < e0; t++) {
              const j = hItems[t]
              if (j === i) continue
              const dx = x[j] - xi
              const dz = z[j] - zi
              const d2 = dx * dx + dz * dz
              if (d2 > overlapR2) continue
              const d = Math.sqrt(d2)
              if (d < 1e-3) {
                const a = rnd() * Math.PI * 2
                rx += Math.cos(a) * 0.9
                rz += Math.sin(a) * 0.9
                if (--budget <= 0) break
                continue
              }
              const overlap = (overlapDist - d) / overlapDist
              // 线性弹簧 + 少量非线性硬化
              const mag = repStrength * overlap * (1.4 + overlap)
              const invd = 1 / d
              rx += dx * invd * mag
              rz += dz * invd * mag
              if (--budget <= 0) break
            }
          }
        }
        // 分解为「沿目标方向」与「横向」两个分量.
        // 拥堵时若允许斥力完全反向, 人堆会互相顶住形成死锁 (经典社会力模型的密度死锁).
        // 这里只保留较弱的反向分量, 横向分量用于侧向让行, 从而形成排队/车道.
        // 拥挤时把斥力整体衰减 (改由位置级分离负责), 保证目标方向始终占优
        const dense = localDensityEstimate
        const scale = dense > 2.5 ? Math.max(0.15, 1 - (dense - 2.5) / 5) : 1
        let along = (rx * fx + rz * fz) * scale
        let px = (rx - (rx * fx + rz * fz) * fx) * scale
        let pz = (rz - (rx * fx + rz * fz) * fz) * scale
        if (along < 0) along *= 0.25
        const pl = Math.sqrt(px * px + pz * pz)
        if (pl > 1.0) {
          px = (px / pl) * 1.0
          pz = (pz / pl) * 1.0
        }
        rx = px + along * fx
        rz = pz + along * fz
      }

      // BVH 射线避让
      let ax = fx
      let az = fz
      if (c >= 0 && nearObstacle[c] && (i & 3) === probeMod) {
        const pr = this.bvh.probe(xi, zi, fx, fz, rayDist, PROBE_ANGLES)
        if (pr.hit) {
          ax = pr.bx
          az = pr.bz
        }
      }

      let v0 = speed[i]
      const localDensity = c >= 0 ? this.densityGrid[c] : 0
      // 密度-速度基本图: 自由流 1.0 倍, 拥堵区最低保留 30% 期望速度,
      // 避免完全静止造成死锁 (真实人群中即便 6 人/m² 仍有缓慢蠕动)
      const jam = localDensity > 5.6 ? 1 : localDensity / 5.6
      const slow = 1 - jam * jam * 0.55
      v0 *= slow < 0.45 ? 0.45 : slow
      if (v0 < 0.3) v0 = 0.3

      if (c >= 0) {
        const li = laneRef[c]
        if (li >= 0) {
          const lane = lanes[li]
          const occ = lanePop[li]
          const cap = lane.capacity > 1 ? lane.capacity : 1
          // 闸门内按通道权重决定通行率, 不再叠加密度减速 (瓶颈本身决定吞吐)
          let m = 0.22 + 0.78 * clamp(lane.weight, 0, 1)
          if (occ > cap) m *= cap / occ
          v0 = speed[i] * clamp(m, 0.15, 1)
        }
        const oi = obstacleRef[c]
        if (oi >= 0) {
          const cap = obstacleCap[oi]
          if (cap > 0) {
            const occ = obstaclePop[oi]
            if (occ > cap) v0 *= clamp(cap / occ, 0.15, 1)
          }
        }
      }

      const k8dt = 8.0 * dt
      vx[i] += (ax * v0 + rx * 0.55 - vx[i]) * k8dt
      vz[i] += (az * v0 + rz * 0.55 - vz[i]) * k8dt
      const sp2 = vx[i] * vx[i] + vz[i] * vz[i]
      const maxSp = v0 * 1.15
      if (sp2 > maxSp * maxSp) {
        const scale = maxSp / Math.sqrt(sp2)
        vx[i] *= scale
        vz[i] *= scale
      }

      let nx = xi + vx[i] * dt
      let nz = zi + vz[i] * dt
      if (c >= 0) {
        const bi = beltRef[c]
        if (bi >= 0) {
          const b = belts[bi]
          nx += b.vx * dt
          nz += b.vz * dt
        }
      }

      const nc = navCellAt(nav, nx, nz)
      if (nc < 0 || blocked[nc]) {
        const tcx = navCellAt(nav, nx, zi)
        const tcz = navCellAt(nav, xi, nz)
        const okX = tcx >= 0 && !blocked[tcx]
        const okZ = tcz >= 0 && !blocked[tcz]
        if (okX) {
          nz = zi
          vz[i] *= -0.15
        } else if (okZ) {
          nx = xi
          vx[i] *= -0.15
        } else {
          nx = xi
          nz = zi
          vx[i] *= -0.2
          vz[i] *= -0.2
        }
      }
      if (this.bvh.insideSolid(nx, nz, radius * 0.9)) {
        nx = xi
        nz = zi
        vx[i] *= -0.25
        vz[i] *= -0.25
      }
      // 位置级重叠消解 (PBD): 累加所有重叠邻居的分离方向, 每步迭代 2 次.
      // 速度层只负责引导, 真正的"不穿模"由位置投影保证, 这样密集人群不会因
      // 速度抵消而卡死, 只会被推成有序的队列.
      if (localDensityEstimate > 0.35 && (forceSep || (i & 1) === (this.stepCount & 1))) {
        const sepDist = radius * 2
        for (let iter = 0; iter < sepIters; iter++) {
          let px = 0
          let pz = 0
          let cnt = 0
          const sx = nx
          const sz = nz
          if (hash.cellOf(sx, sz) >= 0) {
            hash.forEachNear(sx, sz, sepDist, (j, ddx, ddz, dd2) => {
              if (j === i) return
              const d = Math.sqrt(dd2)
              if (d > sepDist) return
              if (d < 1e-4) {
                const a = rnd() * Math.PI * 2
                px += Math.cos(a)
                pz += Math.sin(a)
                cnt++
                return
              }
              const overlap = sepDist - d
              px -= (ddx / d) * overlap
              pz -= (ddz / d) * overlap
              cnt++
            })
          }
          if (cnt === 0) break
          const len = Math.sqrt(px * px + pz * pz)
          if (len < 1e-6) break
          // 单步最多推开 0.6 个半径, 避免爆炸
          const maxPush = radius * 1.2
          const k = Math.min(1, maxPush / (len / cnt))
          nx = sx + (px / cnt) * k
          nz = sz + (pz / cnt) * k
          // 分离后若落入阻挡, 撤销该轴
          const chk = navCellAt(nav, nx, nz)
          if (chk < 0 || blocked[chk]) {
            const chkX = navCellAt(nav, nx, sz)
            if (chkX >= 0 && !blocked[chkX]) {
              nz = sz
            } else {
              nx = sx
              nz = sz
              break
            }
          }
        }
      }
      const mdx = nx - xi
      const mdz = nz - zi
      const moved2 = mdx * mdx + mdz * mdz
      x[i] = nx
      z[i] = nz
      let ph = phase[i] + Math.sqrt(moved2) / 0.7
      if (ph > 1) ph -= 1
      phase[i] = ph

      if (moved2 < (0.02 * dt * 10) ** 2) stall[i] += dt
      else if (stall[i] > 0) stall[i] = Math.max(0, stall[i] - dt * 0.5)

      const cn = nc >= 0 && !blocked[nc] ? nc : c
      if (cn >= 0) {
        const zref = zoneRef[cn]
        if (zref >= 0) {
          const sk = zoneSink[zref]
          if (sk >= 0) {
            sinkTokens[sk] += sinks[sk].serviceRate * dt
            if (sinkTokens[sk] >= 1) {
              sinkTokens[sk] -= 1
              this.served++
              this.removeAgentAt(i)
              i--
              continue
            }
          }
        }
      }

      if (!isFinite(x[i]) || !isFinite(z[i])) {
        this.removeAgentAt(i)
        i--
        continue
      }
      if (stall[i] > 45) {
        this.respawnStuck(i, rnd)
        stall[i] = 0
      }
    }

    if (this.stepCount >= this.nextCheckpointStep) {
      this.makeCheckpoint(this.frame, this.time)
      this.nextCheckpointStep = this.stepCount + Math.max(1, Math.round(5 / dt))
    }
  }

  private spawnAgent(cells: number[], rng: () => number) {
    const nav = this.nav
    let bestCell = -1
    let bestOcc = Infinity
    for (let t = 0; t < 6; t++) {
      const k = cells[(rng() * cells.length) | 0]
      const occ = this.navPop[k] ?? 0
      if (occ < bestOcc) {
        bestOcc = occ
        bestCell = k
      }
    }
    if (bestCell < 0) return
    const i = bestCell % nav.cols
    const j = (bestCell / nav.cols) | 0
    const px = nav.originX + (i + rng()) * nav.cell
    const pz = nav.originZ + (j + rng()) * nav.cell
    if (this.bvh.insideSolid(px, pz, 0.1)) return
    const p = this.doc.params
    const sp = clamp(p.meanSpeed + gaussian(rng) * p.speedSigma, 0.45, 2.4)
    this.pushAgent(px, pz, sp, this.pickSink(px, pz, rng))
  }

  private pickSink(px: number, pz: number, rng: () => number): number {
    const nav = this.nav
    if (nav.sinks.length === 0) return -1
    const c = navCellAt(nav, px, pz)
    let best = 0
    let bestScore = Infinity
    for (let i = 0; i < nav.sinks.length; i++) {
      const d = c >= 0 ? nav.sinkDist[i][c] : Infinity
      const dist = isFinite(d) ? d : Math.hypot(nav.sinks[i].center[0] - px, nav.sinks[i].center[1] - pz) * 2
      const score = dist * (0.75 + rng() * 0.5)
      if (score < bestScore) {
        bestScore = score
        best = i
      }
    }
    return best
  }

  pushAgent(px: number, pz: number, sp: number, sinkIdx: number) {
    if (this.n >= MAX_ACTIVE) return
    const i = this.n++
    this.x[i] = px
    this.z[i] = pz
    this.vx[i] = 0
    this.vz[i] = 0
    this.speed[i] = sp
    this.sink[i] = sinkIdx
    this.phase[i] = this.rng.next()
    this.state[i] = 0
    this.stall[i] = 0
  }

  private removeAgentAt(i: number) {
    const last = --this.n
    if (i === last) return
    this.x[i] = this.x[last]
    this.z[i] = this.z[last]
    this.vx[i] = this.vx[last]
    this.vz[i] = this.vz[last]
    this.speed[i] = this.speed[last]
    this.sink[i] = this.sink[last]
    this.phase[i] = this.phase[last]
    this.state[i] = this.state[last]
    this.stall[i] = this.stall[last]
  }

  private respawnStuck(i: number, rng: () => number) {
    const nav = this.nav
    const src = nav.sources[(rng() * nav.sources.length) | 0]
    if (!src) return
    const k = src.cells[(rng() * src.cells.length) | 0]
    const ci = k % nav.cols
    const cj = (k / nav.cols) | 0
    this.x[i] = nav.originX + (ci + rng()) * nav.cell
    this.z[i] = nav.originZ + (cj + rng()) * nav.cell
    this.vx[i] = 0
    this.vz[i] = 0
  }

  densityGridAt(k: number): number {
    return this.densityGrid[k] ?? 0
  }

  rasterize(out?: Uint8Array) {
    const target = out ?? this.tmpOut
    const res = this.raster.rasterize(this.x, this.z, this.n, target)
    return { density: target, maxDensity: res.maxDensity, bandCounts: Array.from(res.bandCounts) as number[] }
  }

  exportAgents(maxCount = 6000): AgentExport {
    const count = Math.min(this.n, maxCount)
    const stride = Math.max(1, Math.ceil(this.n / maxCount))
    const out: AgentExport = {
      count,
      x: new Float32Array(count),
      z: new Float32Array(count),
      heading: new Float32Array(count),
      phase: new Float32Array(count),
      state: new Uint8Array(count),
    }
    for (let k = 0; k < count; k++) {
      const i = Math.min(this.n - 1, k * stride)
      out.x[k] = this.x[i]
      out.z[k] = this.z[i]
      out.heading[k] = Math.atan2(this.vz[i], this.vx[i])
      out.phase[k] = this.phase[i]
      out.state[k] = this.state[i]
    }
    return out
  }

  stats(maxDensity: number, bandCounts: number[]): FrameStats {
    let sum = 0
    for (let i = 0; i < this.n; i++) sum += Math.sqrt(this.vx[i] * this.vx[i] + this.vz[i] * this.vz[i])
    let gateWait = 0
    for (let k = 0; k < this.nav.lanes.length; k++) gateWait += this.lanePop[k]
    let pop = 0
    let walkable = 0
    const nav = this.nav
    for (let k = 0; k < nav.blocked.length; k++) {
      if (nav.blocked[k]) continue
      walkable++
      pop += this.navPop[k]
    }
    const meanDensity = walkable > 0 ? pop / (walkable * nav.cell * nav.cell) : 0
    return {
      time: this.time,
      occupancy: this.n,
      meanSpeed: this.n > 0 ? sum / this.n : 0,
      maxDensity,
      bandCounts,
      served: this.served,
      waitingAtGates: gateWait,
      spill: this.spill,
      meanDensity,
    }
  }

  makeSnapshot(frame: number) {
    const { density, maxDensity, bandCounts } = this.rasterize()
    return {
      frame,
      time: this.time,
      density: density.slice(),
      stats: this.stats(maxDensity, bandCounts),
      agents: this.exportAgents(),
    }
  }

  makeCheckpoint(frame: number, time: number) {
    const n = this.n
    this.checkpoints.push({
      frame,
      time,
      rngState: this.rng.state,
      n,
      x: this.x.slice(0, n),
      z: this.z.slice(0, n),
      vx: this.vx.slice(0, n),
      vz: this.vz.slice(0, n),
      sink: this.sink.slice(0, n),
      speed: this.speed.slice(0, n),
      phase: this.phase.slice(0, n),
      served: this.served,
      spill: this.spill,
      spawnAcc: this.spawnAcc.slice(),
      sinkTokens: this.sinkTokens.slice(),
      stepCount: this.stepCount,
      nextCheckpointStep: this.nextCheckpointStep,
      dt: this.doc.params.dt,
    })
    if (this.checkpoints.length > 200) this.checkpoints.splice(1, 10)
  }

  restoreCheckpoint(cp: Checkpoint) {
    this.rng = new Rng(0)
    this.rng.state = cp.rngState
    this.n = cp.n
    this.x.set(cp.x)
    this.z.set(cp.z)
    this.vx.set(cp.vx)
    this.vz.set(cp.vz)
    this.sink.set(cp.sink)
    this.speed.set(cp.speed)
    this.phase.set(cp.phase)
    this.served = cp.served
    this.spill = cp.spill
    this.spawnAcc.set(cp.spawnAcc.subarray(0, this.spawnAcc.length))
    this.sinkTokens.set(cp.sinkTokens.subarray(0, this.sinkTokens.length))
    this.time = cp.time
    this.frame = cp.frame
    this.stepCount = cp.stepCount
    this.nextCheckpointStep = cp.nextCheckpointStep
    this.dtAtCheckpoint = cp.dt
  }

  checkpointFor(time: number): Checkpoint {
    let best = this.checkpoints[0]
    for (const cp of this.checkpoints) {
      if (cp.time <= time + 1e-6) best = cp
      else break
    }
    return best
  }

  /** 清空检查点并把时钟归零 (压力测试重新起算用) */
  restartClock() {
    this.stepCount = 0
    this.time = 0
    this.frame = 0
    this.spawnAcc.fill(0)
    this.sinkTokens.fill(0)
    this.served = 0
    this.spill = 0
    this.checkpoints = []
    this.nextCheckpointStep = 0
    this.makeCheckpoint(0, 0)
  }

  /**
   * 从导出的行人快照恢复状态 (导入回放续算用).
   * 导出的快照只有位置/朝向/步态, 缺少速度与目的地, 因此按当前位置重新选汇点,
   * 并以朝向赋予初速度, 使续算起始不会出现明显跳变.
   */
  restoreFromAgents(
    agents: { count: number; x: Float32Array; z: Float32Array; heading: Float32Array; phase: Float32Array },
    time: number,
     seed = 1
  ) {
    this.rng = new Rng(seed)
    const rng = this.rng.next.bind(this.rng)
    this.n = 0
    for (let i = 0; i < agents.count; i++) {
      const px = agents.x[i]
      const pz = agents.z[i]
      if (!isFinite(px) || !isFinite(pz)) continue
      const sp = clamp(this.doc.params.meanSpeed + gaussian(rng) * this.doc.params.speedSigma, 0.45, 2.4)
      this.pushAgent(px, pz, sp, this.pickSink(px, pz, rng))
      const idx = this.n - 1
      this.phase[idx] = agents.phase[i]
      const heading = agents.heading[i]
      this.vx[idx] = Math.cos(heading) * sp * 0.7
      this.vz[idx] = Math.sin(heading) * sp * 0.7
    }
    this.stepCount = Math.round(time / this.doc.params.dt)
    this.time = time
    this.frame = Math.round(time / (this.doc.params.snapshotIntervalMs / 1000))
    this.spawnAcc.fill(0)
    this.sinkTokens.fill(0)
    this.spill = 0
    this.served = 0
    this.checkpoints = []
    this.nextCheckpointStep = this.stepCount
    this.makeCheckpoint(this.frame, this.time)
  }

  fillTo(n: number) {
    const nav = this.nav
    const rng = this.rng.next.bind(this.rng)
    // 建一个可走格列表, 按面积均匀铺人: 每格容量由格面积与目标密度决定
    const cells: number[] = []
    const cellArea = nav.cell * nav.cell
    for (let k = 0; k < nav.blocked.length; k++) if (!nav.blocked[k]) cells.push(k)
    if (cells.length === 0) return
    const perCell = Math.max(1, Math.ceil(n / cells.length))
    // 打乱格序, 避免总是集中在同一段
    for (let i = cells.length - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0
      const t = cells[i]
      cells[i] = cells[j]
      cells[j] = t
    }
    const maxPer = Math.max(1, Math.round(perCell))
    let guard = 0
    let ci = 0
    while (this.n < n && guard++ < n * 12 && ci < cells.length) {
      const k = cells[ci]
      const i0 = k % nav.cols
      const j0 = (k / nav.cols) | 0
      const baseX = nav.originX + i0 * nav.cell
      const baseZ = nav.originZ + j0 * nav.cell
      // 每条格内按六边形网格布置 (间距 = 2r)
      const spacing = Math.max(this.doc.params.radius * 2.4, Math.sqrt(cellArea / maxPer))
      const nx = Math.max(1, Math.floor(nav.cell / spacing))
      const placed: [number, number][] = []
      for (let a = 0; a < nx && placed.length < maxPer; a++) {
        for (let b = 0; b < nx && placed.length < maxPer; b++) {
          placed.push([baseX + (a + 0.5 + (b % 2) * 0.5) * (nav.cell / nx), baseZ + (b + 0.5) * (nav.cell / nx)])
        }
      }
      for (const [px, pz] of placed) {
        if (this.n >= n) break
        if (this.bvh.insideSolid(px, pz, 0.15)) continue
        this.pushAgent(px, pz, clamp(this.doc.params.meanSpeed + gaussian(rng) * 0.15, 0.5, 2), this.pickSink(px, pz, rng))
      }
      ci++
    }
    // 若仍不足 (空间不够), 退回随机补足
    guard = 0
    while (this.n < n && guard++ < n * 4) {
      const k = cells[(rng() * cells.length) | 0]
      const px = nav.originX + (k % nav.cols + rng()) * nav.cell
      const pz = nav.originZ + (((k / nav.cols) | 0) + rng()) * nav.cell
      if (this.bvh.insideSolid(px, pz, 0.15)) continue
      this.pushAgent(px, pz, clamp(this.doc.params.meanSpeed + gaussian(rng) * 0.15, 0.5, 2), this.pickSink(px, pz, rng))
    }
  }

  totalRate(t: number): number {
    let r = 0
    for (const src of this.nav.sources) {
      const curve = this.doc.curves.find((c) => c.id === src.curveId) ?? this.doc.curves[0]
      if (curve) r += sampleCurve(curve.points, t) * src.weight
    }
    return r
  }

  /** 稳态人数估算 */
  estimateSteadyOccupancy(): number {
    let peakRate = 0
    for (let t = 0; t < this.doc.params.duration; t += 2) peakRate = Math.max(peakRate, this.totalRate(t))
    const capacity = this.nav.sinks.reduce((a, s) => a + s.serviceRate, 0)
    return Math.min(this.doc.params.maxPeople, Math.round(Math.min(peakRate, capacity) * 110))
  }

  describe() {
    return {
      sinks: this.nav.sinks.map((s) => ({ zoneId: s.zoneId, rate: s.serviceRate, center: navCellCenter(this.nav, s.cells[0]) })),
      sources: this.nav.sources.map((s) => ({ zoneId: s.zoneId, center: s.center, curveId: s.curveId })),
      walkableCells: this.nav.blocked.reduce((a, b) => a + (b ? 0 : 1), 0),
      cellSize: this.nav.cell,
      zoneSink: Array.from(this.zoneSink),
      zoneIds: this.nav.zoneIds,
    }
  }

  zoneById(id: string): Zone | undefined {
    return this.doc.zones.find((z) => z.id === id)
  }
}

export type { Vec2 }
