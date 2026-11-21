// 站台客流热力仿真 —— 领域模型
// 世界坐标约定: X 向东, Z 向北, Y 向上. 站台平面 (X,Z) 以米为单位.
// 轮廓多边形使用 [x, z] 点对数组, 逆时针为正.

export type Vec2 = [number, number]

export interface Outline {
  /** 站台外轮廓, 单个多边形 */
  outer: Vec2[]
  /** 内部空洞 (可选), 例如轨道间隙 */
  holes?: Vec2[][]
}

/** 付费区/设备区等功能区块, 影响生成与统计 */
export type ZoneKind = 'paid' | 'unpaid' | 'stair' | 'exit' | 'entry' | 'platform-edge' | 'custom'

export interface Zone {
  id: string
  name: string
  kind: ZoneKind
  polygon: Vec2[]
  /** 渲染颜色 (hex) */
  color: string
  /** 楼梯/扶梯卸客点: 行人到达此处后离开仿真 */
  isSink?: boolean
  /** 是否为行人投放点 (进站口) */
  isSource?: boolean
  /** 投放曲线 id */
  arrivalCurveId?: string
  /** 疏散点服务率 (人/秒), 仅 isSink 时生效 */
  serviceRate?: number
  /** 权重: 影响该区作为目的地的吸引力 */
  weight?: number
}

export type ObstacleKind = 'gate' | 'escalator' | 'column' | 'stair' | 'barrier' | 'shop' | 'custom'

/**
 * 障碍物统一采用「本地矩形」描述: 位置 center, 朝向 rotation (弧度, 绕 Y 轴),
 * 尺寸 size = [宽(x), 深(z)].
 * 闸机额外按 gateCount 均分成多个通道, 每个通道有独立的通过权重/承载人数.
 */
export interface Obstacle {
  id: string
  kind: ObstacleKind
  name: string
  center: Vec2
  rotation: number
  size: Vec2
  height: number
  /** 通行权重 0..1: 越大越容易通行 (闸机=通过率, 障碍物=绕行代价的反比) */
  weight: number
  /** 最大承载人数: 该障碍物前方排队区可容纳的人数上限 */
  capacity: number
  /** 闸机通道数 (仅 kind='gate' 生效) */
  gateCount?: number
  /** 每通道的通过权重; 缺省则均分 weight */
  gateWeights?: number[]
  /** 每通道的最大承载人数; 缺省则均分 capacity */
  gateCapacities?: number[]
  /** 是否可见/启用 */
  enabled: boolean
  /** 是否为实体阻挡 (false 表示仅通行权重约束, 如低矮护栏) */
  solid: boolean
  color?: string
  /** 扶梯/楼梯的行进方向速度 m/s (正=本地 +z, 负=本地 -z) */
  beltSpeed?: number
}

export interface ArrivalCurve {
  id: string
  name: string
  /** 时间点(秒)与到达率(人/秒)控制点, 线性插值 */
  points: Vec2[]
  /** 颜色 */
  color: string
}

export type StationMeta = {
  name: string
  line: string
  note: string
}

export interface SimParams {
  /** 目标同时在场上限 */
  maxPeople: number
  /** 仿真步长 (秒) */
  dt: number
  /** 快照间隔 (ms) —— 题面固定 200ms */
  snapshotIntervalMs: number
  /** 行人期望速度 m/s (正态均值/标准差) */
  meanSpeed: number
  speedSigma: number
  /** 行人半径 m */
  radius: number
  /** 社会力: 排斥强度 */
  repulsion: number
  /** 社会力: 排斥作用距离 m */
  repulsionRange: number
  /** 队列/密度减速: 拥堵时速度衰减系数 */
  congestionFactor: number
  /** BVH 射线避让探测距离 m */
  rayAvoidDist: number
  /** 热力栅格边长 */
  gridSize: number
  /** 色带上限 人/m² */
  densityMax: number
  /** 仿真总时长 (秒) */
  duration: number
}

export const DOC_VERSION = 1

export interface StationDoc {
  version: 1
  id: string
  meta: StationMeta
  outline: Outline
  zones: Zone[]
  obstacles: Obstacle[]
  curves: ArrivalCurve[]
  params: SimParams
  updatedAt: number
}

export const DEFAULT_PARAMS: SimParams = {
  maxPeople: 20000,
  dt: 0.1,
  snapshotIntervalMs: 200,
  meanSpeed: 1.25,
  speedSigma: 0.18,
  radius: 0.22,
  repulsion: 2.4,
  repulsionRange: 1.1,
  congestionFactor: 1.0,
  rayAvoidDist: 2.2,
  gridSize: 512,
  densityMax: 6,
  duration: 600,
}

export const DEFAULT_CURVE: ArrivalCurve = {
  id: 'curve-default',
  name: '默认到达曲线',
  points: [
    [0, 0],
    [40, 12],
    [120, 28],
    [240, 34],
    [360, 26],
    [480, 16],
    [600, 4],
  ],
  color: '#4cc9f0',
}

export const ZONE_COLORS: Record<ZoneKind, string> = {
  paid: '#2a9d8f',
  unpaid: '#8d99ae',
  stair: '#e9c46a',
  exit: '#f4a261',
  entry: '#4cc9f0',
  'platform-edge': '#e76f51',
  custom: '#a8dadc',
}

export const ZONE_LABELS: Record<ZoneKind, string> = {
  paid: '付费区',
  unpaid: '非付费区',
  stair: '楼梯口',
  exit: '出口',
  entry: '进站口',
  'platform-edge': '站台边缘',
  custom: '自定义区',
}

export const OBSTACLE_LABELS: Record<ObstacleKind, string> = {
  gate: '闸机',
  escalator: '扶梯',
  column: '立柱',
  stair: '楼梯',
  barrier: '护栏',
  shop: '商铺/设备',
  custom: '自定义',
}

export const DEFAULT_OBSTACLE: Omit<Obstacle, 'id' | 'center'> = {
  kind: 'column',
  name: '新障碍物',
  rotation: 0,
  size: [1, 1],
  height: 1.2,
  weight: 0.5,
  capacity: 40,
  enabled: true,
  solid: true,
}
