import type { Equipment, ReturnVent, RoomSpec, SupplyVent, WallName } from '../types'
import { SPEED_GEAR_TO_MS } from '../types'

export const DEG = Math.PI / 180
export const RAD = 180 / Math.PI

let idCounter = 1
export function uid(prefix: string): string {
  idCounter += 1
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt))
}

/**
 * 设备本地坐标 (lx,lz) -> 世界 (x,z)。
 * 与 THREE.Object3D 绕 Y 轴 rotation 的约定完全一致:
 * wx = cx + lx·cosθ + lz·sinθ
 * wz = cz − lx·sinθ + lz·cosθ
 */
export function localToWorldXZ(
  cx: number,
  cz: number,
  theta: number,
  lx: number,
  lz: number,
): [number, number] {
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  return [cx + lx * c + lz * s, cz - lx * s + lz * c]
}

/** 世界 (x,z) -> 设备本地 (lx,lz) */
export function worldToLocalXZ(
  cx: number,
  cz: number,
  theta: number,
  wx: number,
  wz: number,
): [number, number] {
  const dx = wx - cx
  const dz = wz - cz
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  return [dx * c - dz * s, dx * s + dz * c]
}

/** 点是否位于设备 OBB 的水平 footprint 内(含容差) */
export function pointInEquipmentFootprint(eq: Equipment, x: number, z: number, eps = 0): boolean {
  const [lx, lz] = worldToLocalXZ(eq.x, eq.z, eq.rotation, x, z)
  return Math.abs(lx) <= eq.w / 2 + eps && Math.abs(lz) <= eq.d / 2 + eps
}

/** 送风口射流方向单位向量(azimuth: 0=-Z 北,顺时针;tilt: 0=垂直向下) */
export function ventDirection(v: SupplyVent): [number, number, number] {
  const a = v.azimuth * DEG
  const t = v.tilt * DEG
  return [Math.sin(t) * Math.sin(a), -Math.cos(t), -Math.sin(t) * Math.cos(a)]
}

export function ventSpeed(v: SupplyVent): number {
  return SPEED_GEAR_TO_MS[v.gear]
}

/** 回风口中心世界坐标(自动贴合墙面) */
export function returnVentWorldPos(
  ret: ReturnVent,
  room: RoomSpec,
): [number, number, number] {
  const hx = room.width / 2
  const hz = room.depth / 2
  const a = clamp(ret.along, 0, wallLength(ret.wall, room))
  switch (ret.wall) {
    case 'west':
      return [-hx + 0.03, ret.y, -hz + a]
    case 'east':
      return [hx - 0.03, ret.y, -hz + a]
    case 'north':
      return [-hx + a, ret.y, -hz + 0.03]
    case 'south':
      return [-hx + a, ret.y, hz - 0.03]
  }
}

export function wallLength(wall: WallName, room: RoomSpec): number {
  return wall === 'west' || wall === 'east' ? room.depth : room.width
}

export function wallHorizontalAxis(wall: WallName): 'x' | 'z' {
  return wall === 'west' || wall === 'east' ? 'z' : 'x'
}

/** 蓝 → 青 → 黄 → 红 停留时间色带(JS 侧,Canvas 热力图用) */
export function ageColorRamp(t: number): [number, number, number] {
  const x = clamp(t, 0, 1)
  const stops: Array<[number, [number, number, number]]> = [
    [0.0, [26, 90, 255]],
    [0.4, [26, 242, 255]],
    [0.75, [255, 217, 51]],
    [1.0, [255, 38, 26]],
  ]
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i]
    const [t1, c1] = stops[i + 1]
    if (x >= t0 && x <= t1) {
      const k = (x - t0) / (t1 - t0)
      return [
        Math.round(lerp(c0[0], c1[0], k)),
        Math.round(lerp(c0[1], c1[1], k)),
        Math.round(lerp(c0[2], c1[2], k)),
      ]
    }
  }
  return stops[stops.length - 1][1]
}

export function downloadTextFile(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
