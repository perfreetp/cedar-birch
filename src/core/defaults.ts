// 内置示例站台 + 模板
import type { ArrivalCurve, Obstacle, StationDoc, Zone, Vec2 } from './types.ts'
import { DEFAULT_CURVE, DEFAULT_PARAMS, ZONE_COLORS } from './types.ts'
import { ensureCCW } from './geometry.ts'

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}

/** 圆角矩形站台轮廓 */
export function roundedRectOutline(w: number, h: number, r = 6, seg = 10): Vec2[] {
  const hw = w / 2
  const hh = h / 2
  const rr = Math.min(r, hw, hh)
  const pts: Vec2[] = []
  const corners: [number, number, number][] = [
    [hw - rr, hh - rr, 0],
    [-hw + rr, hh - rr, Math.PI / 2],
    [-hw + rr, -hh + rr, Math.PI],
    [hw - rr, -hh + rr, Math.PI * 1.5],
  ]
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (Math.PI / 2) * (i / seg)
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr])
    }
  }
  return ensureCCW(pts)
}

export function rectPolygon(cx: number, cz: number, w: number, h: number, rot = 0): Vec2[] {
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  const hw = w / 2
  const hh = h / 2
  return ensureCCW(
    [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ].map(([x, z]) => [cx + x * c - z * s, cz + x * s + z * c] as Vec2),
  )
}

export function makeObstacle(partial: Partial<Obstacle> & Pick<Obstacle, 'kind' | 'center'>): Obstacle {
  const base: Obstacle = {
    id: uid('obs'),
    kind: partial.kind,
    name: partial.name ?? '障碍物',
    center: partial.center,
    rotation: partial.rotation ?? 0,
    size: partial.size ?? [2, 2],
    height: partial.height ?? 1.2,
    weight: partial.weight ?? 0.5,
    capacity: partial.capacity ?? 40,
    enabled: partial.enabled ?? true,
    solid: partial.solid ?? true,
    gateCount: partial.gateCount,
    gateWeights: partial.gateWeights,
    gateCapacities: partial.gateCapacities,
    color: partial.color,
    beltSpeed: partial.beltSpeed,
  }
  return base
}

export function gateBank(cx: number, cz: number, lanes: number, rotation = 0): Obstacle {
  const laneW = 0.68
  const width = lanes * laneW + 0.4
  return makeObstacle({
    kind: 'gate',
    name: `${lanes}通道闸机`,
    center: [cx, cz],
    rotation,
    size: [width, 0.42],
    height: 1.0,
    weight: 0.85,
    capacity: lanes * 45,
    gateCount: lanes,
    gateWeights: Array.from({ length: lanes }, (_, i) => (i % 3 === 0 ? 0.6 : 0.92)),
    gateCapacities: Array.from({ length: lanes }, () => 45),
    solid: true,
    color: '#5b8def',
  })
}

export function createDemoStation(): StationDoc {
  const outline = { outer: roundedRectOutline(124, 26, 7) }
  const zones: Zone[] = []
  const obstacles: Obstacle[] = []

  // 付费区
  zones.push({
    id: 'zone-paid',
    name: '付费区',
    kind: 'paid',
    polygon: rectPolygon(0, 0, 84, 21),
    color: ZONE_COLORS.paid,
  })
  // 两端非付费区
  zones.push({
    id: 'zone-unpaid-w',
    name: '西侧非付费区',
    kind: 'unpaid',
    polygon: rectPolygon(-54, 0, 16, 21),
    color: ZONE_COLORS.unpaid,
  })
  zones.push({
    id: 'zone-unpaid-e',
    name: '东侧非付费区',
    kind: 'unpaid',
    polygon: rectPolygon(54, 0, 16, 21),
    color: ZONE_COLORS.unpaid,
  })
  // 进站口: 非付费区整体作为投放区 (乘客从两端闸机外进入)
  zones.push({
    id: 'zone-entry-w',
    name: '西进站口',
    kind: 'entry',
    polygon: rectPolygon(-53.5, 0, 14, 19),
    color: ZONE_COLORS.entry,
    isSource: true,
    arrivalCurveId: DEFAULT_CURVE.id,
    weight: 1,
  })
  zones.push({
    id: 'zone-entry-e',
    name: '东进站口',
    kind: 'entry',
    polygon: rectPolygon(53.5, 0, 14, 19),
    color: ZONE_COLORS.entry,
    isSource: true,
    arrivalCurveId: DEFAULT_CURVE.id,
    weight: 1,
  })
  // 楼梯口 (下行疏散)
  const stairs: [number, number, number][] = [
    [-28, 6.8, 1],
    [0, 6.8, 1],
    [28, 6.8, 1],
    [-28, -6.8, -1],
    [0, -6.8, -1],
    [28, -6.8, -1],
  ]
  for (const [sx, sz, _dir] of stairs) {
    zones.push({
      id: uid('zone-stair'),
      name: '楼梯口',
      kind: 'stair',
      polygon: rectPolygon(sx, sz, 7, 4.2),
      color: ZONE_COLORS.stair,
      isSink: true,
      serviceRate: 11,
    })
  }
  // 站台边缘警示区
  zones.push({
    id: 'zone-edge-n',
    name: '站台边缘(北)',
    kind: 'platform-edge',
    polygon: rectPolygon(0, -12, 112, 1.2),
    color: ZONE_COLORS['platform-edge'],
  })
  zones.push({
    id: 'zone-edge-s',
    name: '站台边缘(南)',
    kind: 'platform-edge',
    polygon: rectPolygon(0, 12, 112, 1.2),
    color: ZONE_COLORS['platform-edge'],
  })

  // 闸机: 西/东各一组, 横跨付费区边界 (通道净宽 0.68m)
  obstacles.push(gateBank(-46.5, 0, 14, Math.PI / 2))
  obstacles.push(gateBank(46.5, 0, 14, Math.PI / 2))
  // 闸机两侧用护栏封住, 强制行人由通道通过
  for (const sx of [-46.5, 46.5]) {
    obstacles.push(
      makeObstacle({
        kind: 'barrier',
        name: '隔离护栏',
        center: [sx, 8.9],
        rotation: Math.PI / 2,
        size: [8.2, 0.18],
        height: 1.1,
        weight: 0.05,
        capacity: 2,
        solid: true,
        color: '#8b95a5',
      }),
    )
    obstacles.push(
      makeObstacle({
        kind: 'barrier',
        name: '隔离护栏',
        center: [sx, -8.9],
        rotation: Math.PI / 2,
        size: [8.2, 0.18],
        height: 1.1,
        weight: 0.05,
        capacity: 2,
        solid: true,
        color: '#8b95a5',
      }),
    )
  }

  // 立柱
  for (const x of [-36, -20, -4, 12, 28, 40]) {
    for (const z of [-3.2, 3.2]) {
      obstacles.push(
        makeObstacle({
          kind: 'column',
          name: '立柱',
          center: [x, z],
          size: [0.9, 0.9],
          height: 3.2,
          weight: 0.15,
          capacity: 6,
          solid: true,
          color: '#c9ced8',
        }),
      )
    }
  }
  // 扶梯 / 楼梯实体 (靠近楼梯口)
  obstacles.push(
    makeObstacle({
      kind: 'escalator',
      name: '上行扶梯',
      center: [14, -8.5],
      rotation: 0,
      size: [12, 2.4],
      height: 1.1,
      weight: 0.9,
      capacity: 30,
      solid: true,
      beltSpeed: 0.65,
      color: '#7f8c9b',
    }),
  )
  obstacles.push(
    makeObstacle({
      kind: 'escalator',
      name: '下行扶梯',
      center: [-14, 8.5],
      rotation: Math.PI,
      size: [12, 2.4],
      height: 1.1,
      weight: 0.9,
      capacity: 30,
      solid: true,
      beltSpeed: 0.65,
      color: '#7f8c9b',
    }),
  )
  // 商铺
  obstacles.push(
    makeObstacle({
      kind: 'shop',
      name: '便利店',
      center: [-14, -9.4],
      size: [10, 3.4],
      height: 3,
      weight: 0.05,
      capacity: 20,
      solid: true,
      color: '#6b7280',
    }),
  )
  obstacles.push(
    makeObstacle({
      kind: 'shop',
      name: '自助售票',
      center: [14, 9.4],
      size: [8, 3],
      height: 2.6,
      weight: 0.05,
      capacity: 20,
      solid: true,
      color: '#6b7280',
    }),
  )

  const stress: ArrivalCurve = {
    id: 'curve-stress',
    name: '满载压力测试',
    points: [
      [0, 0],
      [20, 120],
      [300, 130],
      [420, 80],
      [600, 20],
    ],
    color: '#f72585',
  }

  return {
    version: 1,
    id: uid('station'),
    meta: { name: '示例换乘站台', line: 'M1 / M7', note: '124m × 26m 岛式站台, 双向进站, 六处楼梯疏散' },
    outline,
    zones,
    obstacles,
    curves: [DEFAULT_CURVE, stress],
    params: { ...DEFAULT_PARAMS },
    updatedAt: Date.now(),
  }
}

export function emptyStation(): StationDoc {
  return {
    version: 1,
    id: uid('station'),
    meta: { name: '未命名站台', line: '', note: '' },
    outline: { outer: roundedRectOutline(80, 20, 6) },
    zones: [],
    obstacles: [],
    curves: [DEFAULT_CURVE],
    params: { ...DEFAULT_PARAMS },
    updatedAt: Date.now(),
  }
}
