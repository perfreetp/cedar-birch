import { reactive } from 'vue'
import type {
  Crane,
  DockLayout,
  DockSegment,
  GantryCrane,
  PortalCrane
} from '../types'
import { evaluateLayout, type EvaluationResult, type SegmentReport } from '../domain/evaluation'
import { boxOverlap, pointInBox, type Box2D } from '../domain/geometry'

export interface CollisionInfo {
  segmentId: string
  kind: 'segment' | 'crane'
  message: string
}

let idSeq = 1
const nextId = (prefix: string) => `${prefix}-${idSeq++}`

function makeGantry(index: number): GantryCrane {
  return {
    id: nextId('g'),
    name: `龙门吊 ${index}`,
    kind: 'gantry',
    x: -20 + index * 6,
    z: -8,
    capacityT: 100,
    liftHeight: 26,
    enabled: true,
    railLength: 46,
    span: 18,
    railAngle: 0,
    margin: 0,
    endFactor: 0.55
  }
}

function makePortal(index: number): PortalCrane {
  return {
    id: nextId('p'),
    name: `门座吊 ${index}`,
    kind: 'portal',
    x: 18 + index * 5,
    z: 12 - index * 4,
    capacityT: 80,
    liftHeight: 30,
    enabled: true,
    boomLength: 32,
    minRadius: 6,
    boomAngle: (32 * Math.PI) / 180,
    slewStart: (-Math.PI * 3) / 4,
    slewRange: Math.PI * 1.5
  }
}

function makeSegment(index: number, x: number, z: number, weight: number): DockSegment {
  return {
    id: nextId('s'),
    name: `分段 S${index}`,
    x,
    z,
    rotationY: 0,
    length: 12,
    width: 6,
    height: 5,
    weightT: weight,
    sequence: 0,
    removed: false
  }
}

class DockStore {
  dockWidth = 80
  dockLength = 50
  gridSize = 2
  coopMinCranes = 2

  cranes: Crane[] = reactive([])
  segments: DockSegment[] = reactive([])
  selectedCraneId: string | null = null
  selectedSegmentId: string | null = null

  /** 评估版本号，每次重算自增，供视图层 watch */
  evalVersion = 0
  lastEvaluation: EvaluationResult | null = null
  segmentReports: SegmentReport[] = reactive([])
  collisions: CollisionInfo[] = reactive([])

  private listeners = new Set<() => void>()

  constructor() {
    // 龙门吊 1：东西向轨道，覆盖坞区西侧条带
    const g1 = makeGantry(1)
    g1.x = -16
    g1.z = 0
    g1.railLength = 40
    g1.span = 20
    g1.railAngle = 0
    // 龙门吊 2：南北向轨道，与 G1 在坞区中部交叠，形成协同区
    const g2 = makeGantry(2)
    g2.x = 2
    g2.z = 4
    g2.railAngle = Math.PI / 2
    g2.railLength = 36
    g2.span = 18
    // 门座吊 1：坞区东北，扇形回转域与两台龙门吊交叠
    const p1 = makePortal(1)
    p1.x = 26
    p1.z = 16
    p1.slewStart = (-Math.PI * 3) / 4
    p1.slewRange = Math.PI * 1.5
    // 门座吊 2：坞区西南角
    const p2 = makePortal(2)
    p2.x = -30
    p2.z = -16
    p2.boomLength = 26
    p2.slewStart = Math.PI / 4
    p2.slewRange = Math.PI * 1.4
    this.cranes.push(g1, g2, p1, p2)

    // S1：G1 单机可吊；S2：落在 G1/G2 交叠区、重量大需要协同；S3：门座吊 2 可达
    // 坐标均取在门架 footprint 内部，避免默认场景出现边界碰撞
    const s1 = makeSegment(1, -24, 3, 45)
    s1.length = 10
    // G2 中心 (2,4)、南北向跨距半宽 9m（X 向 [-7,11]），S2 完全收在内部
    const s2 = makeSegment(2, 0, 4, 150)
    s2.length = 8
    s2.width = 5
    // G1 中心 (-16,0)、跨距半宽 10m（Z 向 [-10,10]），S3 完全收在内部
    const s3 = makeSegment(3, -20, -6, 22)
    s3.length = 7
    s3.width = 5
    this.segments.push(s1, s2, s3)
    this.segments[0].sequence = 1
    this.segments[1].sequence = 2
    this.segments[2].sequence = 3

    this.refresh()
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    this.listeners.forEach((fn) => fn())
  }

  addCrane(kind: 'gantry' | 'portal') {
    const index = this.cranes.filter((c) => c.kind === kind).length + 1
    const crane = kind === 'gantry' ? makeGantry(index) : makePortal(index)
    crane.x = (Math.random() - 0.5) * 20
    crane.z = (Math.random() - 0.5) * 12
    this.cranes.push(crane)
    this.selectedCraneId = crane.id
    this.refresh()
  }

  removeCrane(id: string) {
    const i = this.cranes.findIndex((c) => c.id === id)
    if (i >= 0) this.cranes.splice(i, 1)
    if (this.selectedCraneId === id) this.selectedCraneId = null
    this.refresh()
  }

  addSegment() {
    const seg = makeSegment(this.segments.length + 1, (Math.random() - 0.5) * 24, (Math.random() - 0.5) * 12, 40)
    this.segments.push(seg)
    this.selectedSegmentId = seg.id
    this.refresh()
  }

  removeSegment(id: string) {
    const i = this.segments.findIndex((s) => s.id === id)
    if (i >= 0) this.segments.splice(i, 1)
    this.refresh()
  }

  updateCrane(id: string, patch: Partial<Crane>) {
    const crane = this.cranes.find((c) => c.id === id)
    if (!crane) return
    Object.assign(crane, patch)
    this.refresh()
  }

  updateSegment(id: string, patch: Partial<DockSegment>) {
    const seg = this.segments.find((s) => s.id === id)
    if (!seg) return
    Object.assign(seg, patch)
    this.refresh()
  }

  selectCrane(id: string | null) {
    this.selectedCraneId = id
    if (id) this.selectedSegmentId = null
    this.emit()
  }

  selectSegment(id: string | null) {
    this.selectedSegmentId = id
    if (id) this.selectedCraneId = null
    this.emit()
  }

  /** 吊装序列：把指定段移走，释放其占据的可达域 */
  markRemoved(id: string, removed: boolean) {
    const seg = this.segments.find((s) => s.id === id)
    if (!seg) return
    seg.removed = removed
    this.refresh()
  }

  /** 按序列顺序移走下一个未吊装分段 */
  liftNext(): DockSegment | null {
    const pending = this.segments
      .filter((s) => !s.removed && s.sequence > 0)
      .sort((a, b) => a.sequence - b.sequence)
    if (pending.length === 0) return null
    pending[0].removed = true
    this.refresh()
    return pending[0]
  }

  resetSequence() {
    this.segments.forEach((s) => (s.removed = false))
    this.refresh()
  }

  setSequenceOrder(orderedIds: string[]) {
    orderedIds.forEach((id, i) => {
      const seg = this.segments.find((s) => s.id === id)
      if (seg) seg.sequence = i + 1
    })
    this.refresh()
  }

  /** 全量重算：网格评估 + 碰撞检测，触发视图刷新 */
  refresh() {
    this.lastEvaluation = evaluateLayout(this.cranes, this.segments, {
      dockWidth: this.dockWidth,
      dockLength: this.dockLength,
      gridSize: this.gridSize,
      coopMinCranes: this.coopMinCranes
    })
    this.segmentReports.splice(0, this.segmentReports.length, ...this.lastEvaluation.segmentReports)
    this.detectCollisions()
    this.evalVersion++
    this.emit()
  }

  private detectCollisions() {
    const infos: CollisionInfo[] = []
    const active = this.segments.filter((s) => !s.removed)
    const boxOf = (s: DockSegment): Box2D => ({
      cx: s.x,
      cz: s.z,
      halfL: s.length / 2,
      halfW: s.width / 2,
      angle: s.rotationY
    })

    // 分段之间碰撞
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        if (boxOverlap(boxOf(active[i]), boxOf(active[j]))) {
          infos.push({
            segmentId: active[i].id,
            kind: 'segment',
            message: `${active[i].name} 与 ${active[j].name} 平面投影重叠`
          })
        }
      }
    }

    // 分段与吊车本体碰撞（分段自身所在的门架 footprint 是正常作业位，不告警）
    for (const seg of active) {
      const sb = boxOf(seg)
      for (const crane of this.cranes) {
        if (!crane.enabled) continue
        if (crane.kind === 'gantry') {
          const footprint: Box2D = {
            cx: crane.x,
            cz: crane.z,
            halfL: crane.railLength / 2,
            halfW: crane.span / 2,
            angle: crane.railAngle
          }
          // 分段整体位于门架 footprint 内部视为正常占位，只有“横跨边界”才告警
          const corners = [
            [sb.halfL, sb.halfW],
            [-sb.halfL, sb.halfW],
            [-sb.halfL, -sb.halfW],
            [sb.halfL, -sb.halfW]
          ].map(([u, v]) => {
            const c = Math.cos(sb.angle)
            const s = Math.sin(sb.angle)
            return { x: sb.cx + u * c - v * s, z: sb.cz + u * s + v * c }
          })
          const insideCount = corners.filter((p) => pointInBox(p.x, p.z, footprint)).length
          if (boxOverlap(sb, footprint) && insideCount !== corners.length && insideCount !== 0) {
            infos.push({
              segmentId: seg.id,
              kind: 'crane',
              message: `${seg.name} 横跨 ${crane.name} 门架边界`
            })
          }
        } else {
          const corners = [
            [sb.halfL, sb.halfW],
            [-sb.halfL, sb.halfW],
            [-sb.halfL, -sb.halfW],
            [sb.halfL, -sb.halfW]
          ].map(([u, v]) => {
            const c = Math.cos(sb.angle)
            const s = Math.sin(sb.angle)
            return { x: sb.cx + u * c - v * s, z: sb.cz + u * s + v * c }
          })
          const rSafe = crane.minRadius * 0.9
          if (corners.some((p) => Math.hypot(p.x - crane.x, p.z - crane.z) < rSafe)) {
            infos.push({
              segmentId: seg.id,
              kind: 'crane',
              message: `${seg.name} 进入 ${crane.name} 底座回转半径`
            })
          }
        }
      }
    }
    this.collisions.splice(0, this.collisions.length, ...infos)
  }

  exportLayout(): DockLayout {
    return {
      version: 1,
      dockWidth: this.dockWidth,
      dockLength: this.dockLength,
      gridSize: this.gridSize,
      cranes: JSON.parse(JSON.stringify(this.cranes)),
      segments: JSON.parse(JSON.stringify(this.segments)),
      exportedAt: new Date().toISOString()
    }
  }

  importLayout(layout: DockLayout): boolean {
    if (!layout || layout.version !== 1 || !Array.isArray(layout.cranes)) return false
    this.dockWidth = layout.dockWidth
    this.dockLength = layout.dockLength
    this.gridSize = layout.gridSize
    this.cranes.splice(0, this.cranes.length, ...layout.cranes)
    this.segments.splice(0, this.segments.length, ...(layout.segments ?? []))
    this.selectedCraneId = null
    this.selectedSegmentId = null
    this.refresh()
    return true
  }
}

export const store = new DockStore()
