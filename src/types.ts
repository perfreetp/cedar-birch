/** 栅格数据:行优先存储,data[row * width + col],row 0 为北(上) */
export interface RasterGrid {
  width: number
  height: number
  /** 左上角(西北角)X 坐标 */
  originX: number
  /** 左上角(西北角)Y 坐标 */
  originY: number
  /** 像元大小(米) */
  cellSize: number
  /** 高程或深度值 */
  data: Float32Array
  nodata?: number
}

export interface DatasetMeta {
  name: string
  width: number
  height: number
  originX: number
  originY: number
  cellSize: number
  frameCount: number
  /** 每帧对应的物理时间(秒,相对溃坝时刻) */
  times: number[]
  /** 高程范围 */
  minElev: number
  maxElev: number
  /** 最大水深(用于色带参考) */
  maxDepth: number
  /** 每帧淹没面积(m²),加载时统计 */
  areas: number[]
  createdAt: number
}

export interface PickedInfo {
  col: number
  row: number
  x: number
  y: number
  elev: number
  /** 当前时刻水深(米) */
  depth: number
  /** 到达时间(秒),-1 表示全程未淹没 */
  arrivalTime: number
}

export const DEPTH_THRESHOLD = 0.05 // 判定淹没的最小水深(米)

/** 0.5m ~ 5m 六级色带 */
export const DEPTH_RAMP: { stop: number; color: [number, number, number] }[] = [
  { stop: 0.5, color: [0.62, 0.86, 0.95] },
  { stop: 1.0, color: [0.40, 0.72, 0.92] },
  { stop: 1.5, color: [0.25, 0.56, 0.88] },
  { stop: 2.0, color: [0.14, 0.40, 0.82] },
  { stop: 3.0, color: [0.07, 0.26, 0.72] },
  { stop: 5.0, color: [0.03, 0.13, 0.55] },
]
