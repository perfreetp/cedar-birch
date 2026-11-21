// 全局领域模型与共享类型

export interface RoomSpec {
  /** 房间宽 (X 方向,米) */
  width: number
  /** 房间深 (Z 方向,米) */
  depth: number
  /** 房间高 (Y 方向,米) */
  height: number
  /** 送风口数量(第 1 页设定,第 2 页据此生成顶棚网格) */
  supplyCount: number
}

export interface Equipment {
  id: string
  name: string
  /**  footprint 中心世界坐标 */
  x: number
  z: number
  /**  footprint 尺寸(本地轴) */
  w: number
  d: number
  /** 挤出高度,设备落地,y ∈ [0, h] */
  h: number
  /** 绕 Y 轴旋转(弧度),与 THREE.Object3D.rotation.y 一致 */
  rotation: number
  color: number
}

/** 送风速度档位 1-5,映射到 m/s */
export type SpeedGear = 1 | 2 | 3 | 4 | 5

export interface SupplyVent {
  id: string
  /** 顶棚平面位置 */
  x: number
  z: number
  gear: SpeedGear
  /** 方位角(度):0 = 指向 -Z(北),顺时针 */
  azimuth: number
  /** 倾角(度):0 = 垂直向下,最大 60° */
  tilt: number
}

export type WallName = 'west' | 'east' | 'north' | 'south'

export interface ReturnVent {
  id: string
  wall: WallName
  /** 沿墙方向的位置(米,从墙的负端起算) */
  along: number
  /** 中心高度 */
  y: number
  width: number
  height: number
}

export interface SimSettings {
  /** 目标同屏粒子数(上限 20000) */
  targetCount: number
  speedMul: number
  sliceEnabled: boolean
  sliceHeight: number
  sliceBand: number
  running: boolean
}

export interface Snapshot {
  app: 'cleanroom-flowviz'
  version: 1
  exportedAt: string
  room: RoomSpec
  equipment: Equipment[]
  supplies: SupplyVent[]
  returns: ReturnVent[]
  settings: SimSettings
  /** 可选:粒子帧与截图(完整快照) */
  particles?: { count: number; positions: number[]; ages: number[] }
  images?: { viewport?: string; slice?: string }
}

export const SPEED_GEAR_TO_MS: Record<SpeedGear, number> = {
  1: 0.15,
  2: 0.25,
  3: 0.35,
  4: 0.5,
  5: 0.7,
}

export const MAX_PARTICLES = 20000
