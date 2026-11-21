import type {
  Crane,
  DockSegment,
  GridCellResult,
  CellStatus,
  CellCoverage
} from '../types'
import {
  gantryReachable,
  gantryCapacity,
  portalReachable,
  portalCapacity,
  pointInBox,
  type Box2D
} from './geometry'

export interface EvaluationOptions {
  dockWidth: number // X 向（米）
  dockLength: number // Z 向（米）
  gridSize: number // 单元边长（米）
  /** 协同判定：交叠吊车数达到该值即标记可协同 */
  coopMinCranes: number
}

export interface EvaluationResult {
  nx: number
  nz: number
  cells: GridCellResult[]
  /** 每台吊车在每个单元的原始评估，索引 [craneIndex * cellCount + cellIndex] */
  perCrane: CellCoverage[][]
  craneIds: string[]
  /** 每个分段的吊装可行性结论 */
  segmentReports: SegmentReport[]
  /** 单元索引 -> 该单元上所有未移走分段的重量需求（吨） */
  cellDemand: Map<number, number>
  /** 被判定为红色缺口（可达但容量不足）的单元索引 */
  insufficientCells: number[]
  /** 被阻挡单元索引 */
  blockedCells: number[]
}

export interface SegmentReport {
  segmentId: string
  reachableCraneIds: string[]
  /** 单机即可满足的吊车 */
  soloCapableCraneIds: string[]
  /** 需要协同（交叠且容量之和满足） */
  coopCapable: boolean
  /** 覆盖分段中心的单元状态明细 */
  centerStatus: CellStatus
  /** 不满足重量的位置（红色缺口单元中心） */
  gapPoints: { x: number; z: number }[]
  feasible: boolean
  reasons: string[]
}

function craneReachable(crane: Crane, x: number, z: number): boolean {
  return crane.kind === 'gantry'
    ? gantryReachable(crane, x, z)
    : portalReachable(crane, x, z)
}

function craneCapacity(crane: Crane, x: number, z: number): number {
  return crane.kind === 'gantry'
    ? gantryCapacity(crane, x, z)
    : portalCapacity(crane, x, z)
}

function segmentBox(s: DockSegment): Box2D {
  return {
    cx: s.x,
    cz: s.z,
    halfL: s.length / 2,
    halfW: s.width / 2,
    angle: s.rotationY
  }
}

/**
 * 全坞区网格评估：
 * - 逐吊车 × 逐单元判定可达、剩余起重量、阻挡、足量
 * - 汇总单元状态（空 / 覆盖 / 不足 / 缺口 / 协同）
 * - 对每个未移走分段输出吊装可行性报告
 */
export function evaluateLayout(
  cranes: Crane[],
  segments: DockSegment[],
  opts: EvaluationOptions
): EvaluationResult {
  const { dockWidth: w, dockLength: l, gridSize } = opts
  const nx = Math.max(1, Math.round(w / gridSize))
  const nz = Math.max(1, Math.round(l / gridSize))
  const cellCount = nx * nz
  const activeCranes = cranes.filter((c) => c.enabled)
  const activeSegments = segments.filter((s) => !s.removed)

  const cells: GridCellResult[] = new Array(cellCount)
  const perCrane: CellCoverage[][] = activeCranes.map(() => new Array(cellCount))

  // 以坞区中心为原点
  const x0 = -w / 2
  const z0 = -l / 2

  // 先计算每个单元上的分段重量需求，以及占用该单元的分段 id
  const cellDemand = new Map<number, number>()
  const cellOccupants = new Map<number, string[]>()
  for (const seg of activeSegments) {
    const box = segmentBox(seg)
    const minIx = Math.max(0, Math.floor((seg.x - seg.length / 2 - x0) / gridSize) - 1)
    const maxIx = Math.min(nx - 1, Math.ceil((seg.x + seg.length / 2 - x0) / gridSize) + 1)
    const minIz = Math.max(0, Math.floor((seg.z - seg.width / 2 - z0) / gridSize) - 1)
    const maxIz = Math.min(nz - 1, Math.ceil((seg.z + seg.width / 2 - z0) / gridSize) + 1)
    for (let iz = minIz; iz <= maxIz; iz++) {
      for (let ix = minIx; ix <= maxIx; ix++) {
        const cx = x0 + (ix + 0.5) * gridSize
        const cz = z0 + (iz + 0.5) * gridSize
        if (!pointInBox(cx, cz, box)) continue
        const idx = iz * nx + ix
        cellDemand.set(idx, Math.max(cellDemand.get(idx) ?? 0, seg.weightT))
        const occ = cellOccupants.get(idx) ?? []
        occ.push(seg.id)
        cellOccupants.set(idx, occ)
      }
    }
  }

  const insufficientCells: number[] = []
  const blockedCells: number[] = []

  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const idx = iz * nx + ix
      const cx = x0 + (ix + 0.5) * gridSize
      const cz = z0 + (iz + 0.5) * gridSize
      const demand = cellDemand.get(idx) ?? 0
      const occupants = new Set(cellOccupants.get(idx) ?? [])

      const covering: string[] = []
      let maxCap = 0
      let anyInsufficient = false
      let anyBlocked = false

      for (let ci = 0; ci < activeCranes.length; ci++) {
        const crane = activeCranes[ci]
        const reachable = craneReachable(crane, cx, cz)
        let capacity = 0
        let blocked = false
        let sufficient = false

        if (reachable) {
          capacity = craneCapacity(crane, cx, cz)
          // 只有“其他分段”才算阻挡障碍，分段自身不阻挡自己的可达判定
          blocked = activeSegments.some(
            (s) => !occupants.has(s.id) && pointInBox(cx, cz, segmentBox(s))
          )
          if (!blocked) {
            covering.push(crane.id)
            maxCap = Math.max(maxCap, capacity)
            sufficient = demand === 0 || capacity >= demand
            if (demand > 0 && !sufficient) anyInsufficient = true
          } else {
            anyBlocked = true
          }
        }
        perCrane[ci][idx] = { craneId: crane.id, reachable, capacity, blocked, sufficient }
      }

      // 单元状态优先级：不足(红) > 阻挡(缺口) > 协同 > 普通覆盖 > 空
      let status: CellStatus = 'empty'
      if (anyInsufficient) status = 'insufficient'
      else if (covering.length === 0 && anyBlocked) status = 'blocked'
      else if (covering.length >= opts.coopMinCranes) status = 'coop'
      else if (covering.length === 1) status = 'covered'

      if (status === 'insufficient') insufficientCells.push(idx)
      if (status === 'blocked') blockedCells.push(idx)

      cells[idx] = {
        ix,
        iz,
        cx,
        cz,
        status,
        craneIds: covering,
        maxCapacity: maxCap,
        overlapCount: covering.length
      }
    }
  }

  const segmentReports = segments
    .filter((s) => !s.removed)
    .map((seg) => buildSegmentReport(seg, activeCranes, cells, perCrane, nx, nz, gridSize, x0, z0))

  return {
    nx,
    nz,
    cells,
    perCrane,
    craneIds: activeCranes.map((c) => c.id),
    cellDemand,
    insufficientCells,
    blockedCells,
    segmentReports
  }
}

function cellIndexAt(x: number, z: number, nx: number, nz: number, gridSize: number, x0: number, z0: number): number {
  const ix = Math.floor((x - x0) / gridSize)
  const iz = Math.floor((z - z0) / gridSize)
  if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) return -1
  return iz * nx + ix
}

function buildSegmentReport(
  seg: DockSegment,
  cranes: Crane[],
  cells: GridCellResult[],
  perCrane: CellCoverage[][],
  nx: number,
  nz: number,
  gridSize: number,
  x0: number,
  z0: number
): SegmentReport {
  const box = segmentBox(seg)
  const reachable = new Set<string>()
  const solo = new Set<string>()
  const gapPoints: { x: number; z: number }[] = []
  const reasons: string[] = []

  // 采样分段 footprint 覆盖的网格单元
  const minIx = Math.max(0, Math.floor((seg.x - seg.length / 2 - x0) / gridSize) - 1)
  const maxIx = Math.min(nx - 1, Math.ceil((seg.x + seg.length / 2 - x0) / gridSize) + 1)
  const minIz = Math.max(0, Math.floor((seg.z - seg.width / 2 - z0) / gridSize) - 1)
  const maxIz = Math.min(nz - 1, Math.ceil((seg.z + seg.width / 2 - z0) / gridSize) + 1)

  let sampled = 0
  let coveredSamples = 0
  /** 每个采样点上可达吊车的容量合计，用于协同判定 */
  let bestCombined = 0
  let coopEver = false

  for (let iz = minIz; iz <= maxIz; iz++) {
    for (let ix = minIx; ix <= maxIx; ix++) {
      const cx = x0 + (ix + 0.5) * gridSize
      const cz = z0 + (iz + 0.5) * gridSize
      if (!pointInBox(cx, cz, box)) continue
      sampled++
      const idx = iz * nx + ix
      const here: { id: string; cap: number; blocked: boolean }[] = []
      for (let ci = 0; ci < cranes.length; ci++) {
        const cov = perCrane[ci][idx]
        if (cov.reachable && !cov.blocked) {
          here.push({ id: cov.craneId, cap: cov.capacity, blocked: false })
          reachable.add(cov.craneId)
          if (cov.capacity >= seg.weightT) solo.add(cov.craneId)
        }
      }
      if (here.length > 0) {
        coveredSamples++
        const combined = here.reduce((sum, h) => sum + h.cap, 0)
        bestCombined = Math.max(bestCombined, combined)
        if (here.length >= 2 && combined >= seg.weightT) coopEver = true
        if (here.every((h) => h.cap < seg.weightT) && !coopEver) {
          gapPoints.push({ x: cx, z: cz })
        }
      } else {
        // 完全无可达吊车的采样点 -> 红色缺口
        gapPoints.push({ x: cx, z: cz })
      }
    }
  }

  const centerIdx = cellIndexAt(seg.x, seg.z, nx, nz, gridSize, x0, z0)
  const centerStatus: CellStatus = centerIdx >= 0 ? cells[centerIdx].status : 'empty'

  const coverage = sampled === 0 ? 0 : coveredSamples / sampled
  const feasible = solo.size > 0 || (coopEver && coverage > 0.6)

  if (coverage === 0) reasons.push('分段完全不在任何吊车可达域内')
  else if (coverage < 0.85) reasons.push(`仅 ${(coverage * 100).toFixed(0)}% 的面积被可达域覆盖，存在缺口`)
  if (solo.size === 0 && coverage > 0) {
    reasons.push(`无单机可吊 ${seg.weightT}t，最佳多点合计容量 ${bestCombined.toFixed(1)}t`)
  }
  if (feasible && solo.size === 0) reasons.push('可采用双机/多机协同吊装')

  return {
    segmentId: seg.id,
    reachableCraneIds: [...reachable],
    soloCapableCraneIds: [...solo],
    coopCapable: coopEver,
    centerStatus,
    gapPoints,
    feasible,
    reasons
  }
}
