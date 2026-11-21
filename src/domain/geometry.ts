import type { GantryCrane, PortalCrane } from '../types'

export interface Vec2 {
  x: number
  z: number
}

export function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx
  const dz = az - bz
  return dx * dx + dz * dz
}

/** 角度归一化到 [0, 2π) */
export function norm2pi(a: number): number {
  const twoPi = Math.PI * 2
  return ((a % twoPi) + twoPi) % twoPi
}

/** 判断世界角 theta 是否落在 [start, start+range] 扫掠区间内（range <= 2π） */
export function angleInSweep(theta: number, start: number, range: number): boolean {
  if (range >= Math.PI * 2 - 1e-6) return true
  const t = norm2pi(theta - start)
  return t <= range
}

/* ---------------- 龙门吊 ---------------- */

/** 世界点 -> 龙门吊局部轨道坐标 (u: 沿轨道, v: 跨距方向) */
export function gantryLocal(crane: GantryCrane, wx: number, wz: number): Vec2 {
  const dx = wx - crane.x
  const dz = wz - crane.z
  const c = Math.cos(crane.railAngle)
  const s = Math.sin(crane.railAngle)
  return {
    x: dx * c + dz * s, // u
    z: -dx * s + dz * c // v
  }
}

export function gantryBounds(crane: GantryCrane) {
  const halfL = crane.railLength / 2
  const halfW = crane.span / 2 - crane.margin
  return { uMin: -halfL, uMax: halfL, vMin: -halfW, vMax: halfW }
}

export function gantryReachable(crane: GantryCrane, wx: number, wz: number): boolean {
  const p = gantryLocal(crane, wx, wz)
  const b = gantryBounds(crane)
  return p.x >= b.uMin && p.x <= b.uMax && p.z >= b.vMin && p.z <= b.vMax
}

/** 龙门吊该位置剩余起重量：沿轨道方向线性折减 */
export function gantryCapacity(crane: GantryCrane, wx: number, wz: number): number {
  const p = gantryLocal(crane, wx, wz)
  const t = (p.x + crane.railLength / 2) / crane.railLength
  return crane.capacityT * (1 - (1 - crane.endFactor) * t)
}

/* ---------------- 门座吊 ---------------- */

export function portalMaxRadius(crane: PortalCrane): number {
  return crane.boomLength * Math.cos(crane.boomAngle)
}

/** 转柱/底座高度：保证臂尖高度等于 liftHeight */
export function portalPedestal(crane: PortalCrane): number {
  const tipRise = crane.boomLength * Math.sin(crane.boomAngle)
  return Math.max(2, Math.min(crane.liftHeight - 1, crane.liftHeight - tipRise))
}

/** 半径 r 处臂架下吊钩可达最大高度 */
export function portalTopHeight(crane: PortalCrane, r: number): number {
  return portalPedestal(crane) + r * Math.tan(crane.boomAngle)
}

export interface PortalPolar {
  r: number
  theta: number
}

export function portalPolar(crane: PortalCrane, wx: number, wz: number): PortalPolar {
  return {
    r: Math.hypot(wx - crane.x, wz - crane.z),
    theta: Math.atan2(wz - crane.z, wx - crane.x)
  }
}

export function portalReachable(crane: PortalCrane, wx: number, wz: number): boolean {
  const rMax = portalMaxRadius(crane)
  if (rMax <= crane.minRadius) return false
  const p = portalPolar(crane, wx, wz)
  return (
    p.r >= crane.minRadius &&
    p.r <= rMax &&
    angleInSweep(p.theta, crane.slewStart, crane.slewRange)
  )
}

/**
 * 门座吊该位置剩余起重量：额定重量在 minRadius 处，
 * 线性折减到最大半径处的 10%（100t 臂尖 ≈ 10t，呼应五档区间）
 */
export function portalCapacity(crane: PortalCrane, wx: number, wz: number): number {
  const rMax = portalMaxRadius(crane)
  const p = portalPolar(crane, wx, wz)
  const t = Math.min(1, Math.max(0, (p.r - crane.minRadius) / (rMax - crane.minRadius)))
  return crane.capacityT * (1 - 0.9 * t)
}

/* ---------------- 分段 OBB（2D 投影） ---------------- */

export interface Box2D {
  cx: number
  cz: number
  halfL: number
  halfW: number
  angle: number
}

export function boxWorldCorners(b: Box2D): Vec2[] {
  const c = Math.cos(b.angle)
  const s = Math.sin(b.angle)
  const local = [
    { x: b.halfL, z: b.halfW },
    { x: -b.halfL, z: b.halfW },
    { x: -b.halfL, z: -b.halfW },
    { x: b.halfL, z: -b.halfW }
  ]
  return local.map((p) => ({
    x: b.cx + p.x * c - p.z * s,
    z: b.cz + p.x * s + p.z * c
  }))
}

/** 点是否在 2D 有向盒内 */
export function pointInBox(wx: number, wz: number, b: Box2D): boolean {
  const dx = wx - b.cx
  const dz = wz - b.cz
  const c = Math.cos(b.angle)
  const s = Math.sin(b.angle)
  const u = dx * c + dz * s
  const v = -dx * s + dz * c
  return Math.abs(u) <= b.halfL && Math.abs(v) <= b.halfW
}

/** SAT 判定两个 2D 有向盒是否重叠 */
export function boxOverlap(a: Box2D, b: Box2D): boolean {
  const cornersA = boxWorldCorners(a)
  const cornersB = boxWorldCorners(b)
  const axes = [
    { x: cornersA[1].x - cornersA[0].x, z: cornersA[1].z - cornersA[0].z },
    { x: cornersA[3].x - cornersA[0].x, z: cornersA[3].z - cornersA[0].z },
    { x: cornersB[1].x - cornersB[1].x, z: cornersB[1].z - cornersB[1].z },
    { x: cornersB[3].x - cornersB[1].x, z: cornersB[3].z - cornersB[1].z }
  ]
  for (const axis of axes) {
    const len = Math.hypot(axis.x, axis.z)
    if (len < 1e-9) continue
    const nx = axis.x / len
    const nz = axis.z / len
    let minA = Infinity
    let maxA = -Infinity
    let minB = Infinity
    let maxB = -Infinity
    for (const p of cornersA) {
      const d = p.x * nx + p.z * nz
      minA = Math.min(minA, d)
      maxA = Math.max(maxA, d)
    }
    for (const p of cornersB) {
      const d = p.x * nx + p.z * nz
      minB = Math.min(minB, d)
      maxB = Math.max(maxB, d)
    }
    if (maxA < minB || maxB < minA) return false
  }
  return true
}
